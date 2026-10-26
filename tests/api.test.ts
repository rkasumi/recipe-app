import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig, openDatabase, openJournalDatabase, type RecipeDatabase } from "../src/db/database";
import { importRecipeFile } from "../src/db/recipes";
import { createServer, getHealthStatus, getRecipeDetailResponse, getRecipeListResponse } from "../src/server/index";

const fixturePath = path.resolve("fixtures/recipes/oyakodon.json");
let tempDir: string | null = null;
let db: RecipeDatabase | null = null;
let journalDb: RecipeDatabase | null = null;

afterEach(() => {
  db?.close();
  db = null;
  journalDb?.close();
  journalDb = null;
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("api", () => {
  it("builds health, list, and detail payloads from SQLite", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-app-"));
    const config = loadConfig({ DATA_DIR: tempDir });
    db = openDatabase(config);
    importRecipeFile(db, config, fixturePath, { dryRun: false });

    const health = getHealthStatus(db);
    assert.equal(health.recipeCount, 1);

    const list = getRecipeListResponse(db, "玉ねぎ");
    assert.equal(list.recipes[0].id, "oyakodon-basic");

    const detail = getRecipeDetailResponse(db, "oyakodon-basic");
    assert.ok(detail);
    assert.ok(detail.recipe.flow.nodes.length > 0);
  });

  it("serves API routes, JSON 404s, and the SPA fallback", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-app-"));
    const config = loadConfig({ DATA_DIR: tempDir, ENABLE_WRITES: "true" });
    db = openDatabase(config);
    journalDb = openJournalDatabase(config);
    importRecipeFile(db, config, fixturePath, { dryRun: false });
    const clientDist = path.join(tempDir, "client");
    fs.mkdirSync(clientDist);
    fs.writeFileSync(path.join(clientDist, "index.html"), "<!doctype html><title>recipe-app</title>");
    const app = createServer({ config, db, journalDb, clientDist });

    await withServer(app, async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      assert.partialDeepStrictEqual(await health.json(), { ok: true, recipeCount: 1 });

      const list = await fetch(`${baseUrl}/api/recipes?q=${encodeURIComponent("玉ねぎ")}`);
      assert.equal(list.status, 200);
      assert.equal((await list.json() as { recipes: Array<{ id: string }> }).recipes[0].id, "oyakodon-basic");

      const detail = await fetch(`${baseUrl}/api/recipes/oyakodon-basic`);
      assert.equal(detail.status, 200);

      const capabilities = await fetch(`${baseUrl}/api/capabilities`);
      assert.deepEqual(await capabilities.json(), { notesWritable: true });

      const savedNote = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "ingredient", targetId: "chicken-thigh", note: "うちでは少し小さめに切る" }),
      });
      assert.equal(savedNote.status, 200);
      assert.partialDeepStrictEqual(await savedNote.json(), { note: { targetId: "chicken-thigh", note: "うちでは少し小さめに切る" } });

      const notes = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`);
      const notesBody = await notes.json() as { notes: Array<{ targetType: string; targetId: string }> };
      assert.equal(notesBody.notes.length, 1);
      assert.partialDeepStrictEqual(notesBody.notes[0], { targetType: "ingredient", targetId: "chicken-thigh" });

      const invalidNote = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "step", targetId: "missing", note: "invalid" }),
      });
      assert.equal(invalidNote.status, 400);

      config.enableWrites = false;
      const disabledWrite = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "recipe", targetId: "oyakodon-basic", note: "blocked" }),
      });
      assert.equal(disabledWrite.status, 403);
      const disabledRead = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`);
      assert.equal(disabledRead.status, 403);

      const missingDetail = await fetch(`${baseUrl}/api/recipes/missing`);
      assert.equal(missingDetail.status, 404);
      assert.deepEqual(await missingDetail.json(), { error: "recipe_not_found" });

      const unknownApi = await fetch(`${baseUrl}/api/unknown`);
      assert.equal(unknownApi.status, 404);
      assert.ok(unknownApi.headers.get("content-type")?.includes("application/json"));
      assert.deepEqual(await unknownApi.json(), { error: "not_found" });

      const spa = await fetch(`${baseUrl}/recipes/oyakodon-basic`);
      assert.equal(spa.status, 200);
      assert.ok((await spa.text()).includes("<title>recipe-app</title>"));
    });
  });

  it("does not expose internal error messages", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-app-"));
    const config = loadConfig({ DATA_DIR: tempDir });
    db = openDatabase(config);
    journalDb = openJournalDatabase(config);
    const app = createServer({ config, db, journalDb });
    db.close();
    db = null;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: "internal_error" });
      });
    } finally {
      console.error = originalConsoleError;
    }
  });
});

async function withServer(app: ReturnType<typeof createServer>, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}
