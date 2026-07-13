import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(health.recipeCount).toBe(1);

    const list = getRecipeListResponse(db, "玉ねぎ");
    expect(list.recipes[0].id).toBe("oyakodon-basic");

    const detail = getRecipeDetailResponse(db, "oyakodon-basic");
    expect(detail?.recipe.flow.nodes.length).toBeGreaterThan(0);
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
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, recipeCount: 1 });

      const list = await fetch(`${baseUrl}/api/recipes?q=${encodeURIComponent("玉ねぎ")}`);
      expect(list.status).toBe(200);
      expect((await list.json() as { recipes: Array<{ id: string }> }).recipes[0].id).toBe("oyakodon-basic");

      const detail = await fetch(`${baseUrl}/api/recipes/oyakodon-basic`);
      expect(detail.status).toBe(200);

      const capabilities = await fetch(`${baseUrl}/api/capabilities`);
      expect(await capabilities.json()).toEqual({ notesWritable: true });

      const savedNote = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "ingredient", targetId: "chicken-thigh", note: "うちでは少し小さめに切る" }),
      });
      expect(savedNote.status).toBe(200);
      expect(await savedNote.json()).toMatchObject({ note: { targetId: "chicken-thigh", note: "うちでは少し小さめに切る" } });

      const notes = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`);
      expect(await notes.json()).toMatchObject({ notes: [{ targetType: "ingredient", targetId: "chicken-thigh" }] });

      const invalidNote = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "step", targetId: "missing", note: "invalid" }),
      });
      expect(invalidNote.status).toBe(400);

      config.enableWrites = false;
      const disabledWrite = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "recipe", targetId: "oyakodon-basic", note: "blocked" }),
      });
      expect(disabledWrite.status).toBe(403);
      const disabledRead = await fetch(`${baseUrl}/api/recipes/oyakodon-basic/notes`);
      expect(disabledRead.status).toBe(403);

      const missingDetail = await fetch(`${baseUrl}/api/recipes/missing`);
      expect(missingDetail.status).toBe(404);
      expect(await missingDetail.json()).toEqual({ error: "recipe_not_found" });

      const unknownApi = await fetch(`${baseUrl}/api/unknown`);
      expect(unknownApi.status).toBe(404);
      expect(unknownApi.headers.get("content-type")).toContain("application/json");
      expect(await unknownApi.json()).toEqual({ error: "not_found" });

      const spa = await fetch(`${baseUrl}/recipes/oyakodon-basic`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("<title>recipe-app</title>");
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
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "internal_error" });
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
