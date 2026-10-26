import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig, openDatabase, openJournalDatabase, type AppConfig, type RecipeDatabase } from "../src/db/database";
import { getRecipeDetail, importRecipeFile, listRecipes, syncRecipeFiles } from "../src/db/recipes";
import { listRecipeNotes, saveRecipeNote } from "../src/db/notes";

const fixturePath = path.resolve("fixtures/recipes/oyakodon.json");
let tempDir: string | null = null;
let db: RecipeDatabase | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("recipe import", () => {
  it("imports a fixture into generated SQLite", () => {
    const config = makeConfig();
    db = openDatabase(config);

    const result = importRecipeFile(db, config, fixturePath, { dryRun: false });
    const summaries = listRecipes(db, "鶏");
    const detail = getRecipeDetail(db, "oyakodon-basic");

    assert.equal(result.imported, true);
    assert.equal(summaries.length, 1);
    assert.equal(detail?.recipe.title, "親子丼");
    assert.equal(listRecipes(db, "鶏 玉ねぎ").length, 1);
    assert.deepEqual(listRecipes(db, "鶏 存在しない材料"), []);
    assert.deepEqual(listRecipes(db, "%"), []);
    assert.deepEqual(listRecipes(db, "_"), []);
    assert.equal(fs.existsSync(path.join(config.dataDir, "import-logs", "imports.jsonl")), true);
  });

  it("dry-run validates without writing rows", () => {
    const config = makeConfig();
    db = openDatabase(config);

    const result = importRecipeFile(db, config, fixturePath, { dryRun: true });

    assert.equal(result.dryRun, true);
    assert.deepEqual(listRecipes(db, null), []);
  });

  it("rejects an invalid port during config loading", () => {
    assert.throws(() => loadConfig({ DATA_DIR: ".tmp/test", PORT: "not-a-number" }), /PORT must be an integer/);
    assert.throws(() => loadConfig({ DATA_DIR: ".tmp/test", PORT: "70000" }), /PORT must be an integer/);
  });

  it("sync replaces the generated database only after every recipe validates", () => {
    const config = makeConfig();
    db = openDatabase(config);
    const recipesDir = path.join(config.dataDir, "sync-source");
    fs.mkdirSync(recipesDir);
    fs.copyFileSync(fixturePath, path.join(recipesDir, "oyakodon.json"));

    const stalePath = path.join(config.dataDir, "stale.json");
    const staleRecipe = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { id: string; title: string };
    staleRecipe.id = "stale-recipe";
    staleRecipe.title = "削除対象";
    fs.writeFileSync(stalePath, JSON.stringify(staleRecipe));
    importRecipeFile(db, config, stalePath, { dryRun: false });

    const dryRun = syncRecipeFiles(db, config, recipesDir, { dryRun: true });
    assert.equal(dryRun.synced, false);
    assert.deepEqual(dryRun.deletedRecipeIds, ["stale-recipe"]);
    assert.notEqual(getRecipeDetail(db, "stale-recipe"), null);

    const synced = syncRecipeFiles(db, config, recipesDir, { dryRun: false });
    assert.equal(synced.synced, true);
    assert.equal(getRecipeDetail(db, "stale-recipe"), null);
    assert.ok(getRecipeDetail(db, "oyakodon-basic")?.importedAt);

    fs.writeFileSync(path.join(recipesDir, "invalid.json"), "{}");
    const rejected = syncRecipeFiles(db, config, recipesDir, { dryRun: false });
    assert.equal(rejected.synced, false);
    assert.notEqual(getRecipeDetail(db, "oyakodon-basic"), null);
  });

  it("rejects duplicate IDs without changing existing recipes or import logs", () => {
    const config = makeConfig();
    db = openDatabase(config);
    importRecipeFile(db, config, fixturePath, { dryRun: false });
    const logPath = path.join(config.dataDir, "import-logs", "imports.jsonl");
    const originalLog = fs.readFileSync(logPath, "utf8");
    const recipesDir = path.join(config.dataDir, "duplicates");
    fs.mkdirSync(recipesDir);
    fs.copyFileSync(fixturePath, path.join(recipesDir, "a.json"));
    fs.copyFileSync(fixturePath, path.join(recipesDir, "b.json"));

    for (const dryRun of [true, false]) {
      const result = syncRecipeFiles(db, config, recipesDir, { dryRun });
      assert.equal(result.synced, false);
      assert.deepEqual(result.duplicateRecipeIds, ["oyakodon-basic"]);
      assert.deepEqual(listRecipes(db, null).map((recipe) => recipe.id), ["oyakodon-basic"]);
      assert.equal(fs.readFileSync(logPath, "utf8"), originalLog);
    }
  });

  it("rolls back deletion and earlier inserts when a later sync insert fails", () => {
    const config = makeConfig();
    db = openDatabase(config);
    importRecipeFile(db, config, fixturePath, { dryRun: false });
    const logPath = path.join(config.dataDir, "import-logs", "imports.jsonl");
    const originalLog = fs.readFileSync(logPath, "utf8");
    const recipesDir = path.join(config.dataDir, "rollback");
    fs.mkdirSync(recipesDir);
    for (const id of ["a-valid", "z-rejected"]) {
      const recipe = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
      recipe.id = id;
      fs.writeFileSync(path.join(recipesDir, `${id}.json`), JSON.stringify(recipe));
    }
    const dryRun = syncRecipeFiles(db, config, recipesDir, { dryRun: true });
    assert.equal(dryRun.results.every((result) => result.validation.valid), true);
    assert.deepEqual(dryRun.deletedRecipeIds, ["oyakodon-basic"]);
    assert.notEqual(getRecipeDetail(db, "oyakodon-basic"), null);
    db.exec(`CREATE TRIGGER reject_fixture BEFORE INSERT ON recipes
      WHEN NEW.id = 'z-rejected' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`);

    assert.throws(() => syncRecipeFiles(db!, config, recipesDir, { dryRun: false }), { message: "fixture failure" });
    assert.equal(db.inTransaction, false);
    assert.deepEqual(listRecipes(db, null).map((recipe) => recipe.id), ["oyakodon-basic"]);
    assert.equal(fs.readFileSync(logPath, "utf8"), originalLog);
  });

  it("preserves journal notes across recipe replacement and database reopen", () => {
    const config = makeConfig();
    db = openDatabase(config);
    importRecipeFile(db, config, fixturePath, { dryRun: false });
    const input = { recipeId: "oyakodon-basic", targetType: "recipe" as const, targetId: "oyakodon-basic", note: "fixture note" };
    const journal = openJournalDatabase(config);
    try {
      saveRecipeNote(journal, input);
    } finally {
      journal.close();
    }
    const recipesDir = path.join(config.dataDir, "replacement");
    fs.mkdirSync(recipesDir);
    const replacement = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    replacement.id = "replacement";
    fs.writeFileSync(path.join(recipesDir, "recipe.json"), JSON.stringify(replacement));
    assert.equal(syncRecipeFiles(db, config, recipesDir, { dryRun: true }).synced, false);
    assert.equal(syncRecipeFiles(db, config, recipesDir, { dryRun: false }).synced, true);
    db.close();
    db = openDatabase(config);
    assert.equal(getRecipeDetail(db, "oyakodon-basic"), null);
    assert.notEqual(getRecipeDetail(db, "replacement"), null);
    const reopenedJournal = openJournalDatabase(config);
    try {
      const notes = listRecipeNotes(reopenedJournal, input.recipeId);
      assert.equal(notes.length, 1);
      assert.partialDeepStrictEqual(notes[0], input);
      assert.equal(reopenedJournal.pragma("integrity_check", { simple: true }), "ok");
      assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    } finally {
      reopenedJournal.close();
    }
  });
});

function makeConfig(): AppConfig {
  const root = path.resolve(".tmp/recipe-app");
  fs.mkdirSync(root, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(root, "import-test-"));
  return loadConfig({ DATA_DIR: tempDir });
}
