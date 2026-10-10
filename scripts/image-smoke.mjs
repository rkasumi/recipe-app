import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import console from "node:console";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

// Run with the built app as cwd; CI mounts only these checks and public fixtures.
const require = createRequire(path.resolve("package.json"));
const Database = require("better-sqlite3");
const { fetch } = globalThis;
const fixtures = path.resolve(process.argv[2] ?? "fixtures/recipes");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-app-image-"));
const env = {
  ...process.env,
  HOST: "127.0.0.1", PORT: "18084", ENABLE_WRITES: "false",
  DATA_DIR: dataDir, RECIPES_DIR: fixtures,
  RECIPE_DB_PATH: path.join(dataDir, "recipes.sqlite"),
  JOURNAL_DB_PATH: path.join(dataDir, "journal.sqlite"),
};

function cli(...args) {
  const result = spawnSync(process.execPath, ["dist/cli/index.js", ...args], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function withServer(enableWrites, check) {
  const server = spawn(process.execPath, ["dist/server/index.js"], {
    env: { ...env, ENABLE_WRITES: String(enableWrites) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server startup timeout: ${stderr}`)), 15_000);
      let stdout = "";
      server.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes("recipe-app listening")) { clearTimeout(timer); resolve(); }
      });
      server.once("error", (error) => { clearTimeout(timer); reject(error); });
      server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
    });
    await check(`http://${env.HOST}:${env.PORT}`);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await stopped;
    }
  }
}

try {
  cli("import-all", "--dry-run");
  let db = new Database(env.RECIPE_DB_PATH);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recipes").get().n, 0);
  db.close();
  assert.equal(fs.existsSync(path.join(dataDir, "import-logs")), false);
  cli("sync", "--dry-run");
  cli("sync");
  const note = { targetType: "recipe", targetId: "oyakodon-basic", note: "image fixture note" };
  await withServer(false, async (url) => {
    assert.equal((await (await fetch(`${url}/health`)).json()).recipeCount, 1);
    assert.deepEqual(await (await fetch(`${url}/api/capabilities`)).json(), { notesWritable: false });
    assert.equal((await fetch(`${url}/api/recipes/oyakodon-basic/notes`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(note),
    })).status, 403);
    assert.equal((await fetch(url)).status, 200);
  });
  // This disposable process is loopback-only, with no host port or real data mounted.
  await withServer(true, async (url) => {
    const response = await fetch(`${url}/api/recipes/oyakodon-basic/notes`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(note),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).note.note, note.note);
  });
  cli("sync", "--dry-run");
  cli("sync");
  const journal = new Database(env.JOURNAL_DB_PATH);
  assert.equal(journal.prepare("SELECT note FROM recipe_notes").get().note, note.note);
  assert.equal(journal.pragma("integrity_check", { simple: true }), "ok");
  journal.close();
  db = new Database(env.RECIPE_DB_PATH);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  console.log(JSON.stringify({ node: process.version, abi: process.versions.modules,
    napi: process.versions.napi, sqlite: db.prepare("SELECT sqlite_version() AS version").get().version,
    betterSqlite3: require("better-sqlite3/package.json").version, fixtureSmoke: "passed" }));
  db.close();
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
