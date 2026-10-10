import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

    expect(result.imported).toBe(true);
    expect(summaries).toHaveLength(1);
    expect(detail?.recipe.title).toBe("親子丼");
    expect(listRecipes(db, "鶏 玉ねぎ")).toHaveLength(1);
    expect(listRecipes(db, "鶏 存在しない材料")).toEqual([]);
    expect(listRecipes(db, "%")).toEqual([]);
    expect(listRecipes(db, "_")).toEqual([]);
    expect(fs.existsSync(path.join(config.dataDir, "import-logs", "imports.jsonl"))).toBe(true);
  });

  it("dry-run validates without writing rows", () => {
    const config = makeConfig();
    db = openDatabase(config);

    const result = importRecipeFile(db, config, fixturePath, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(listRecipes(db, null)).toEqual([]);
  });

  it("rejects an invalid port during config loading", () => {
    expect(() => loadConfig({ DATA_DIR: ".tmp/test", PORT: "not-a-number" })).toThrow(/PORT must be an integer/);
    expect(() => loadConfig({ DATA_DIR: ".tmp/test", PORT: "70000" })).toThrow(/PORT must be an integer/);
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
    expect(dryRun.synced).toBe(false);
    expect(dryRun.deletedRecipeIds).toEqual(["stale-recipe"]);
    expect(getRecipeDetail(db, "stale-recipe")).not.toBeNull();

    const synced = syncRecipeFiles(db, config, recipesDir, { dryRun: false });
    expect(synced.synced).toBe(true);
    expect(getRecipeDetail(db, "stale-recipe")).toBeNull();
    expect(getRecipeDetail(db, "oyakodon-basic")?.importedAt).toBeTruthy();

    fs.writeFileSync(path.join(recipesDir, "invalid.json"), "{}");
    const rejected = syncRecipeFiles(db, config, recipesDir, { dryRun: false });
    expect(rejected.synced).toBe(false);
    expect(getRecipeDetail(db, "oyakodon-basic")).not.toBeNull();
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
      expect(result.synced).toBe(false);
      expect(result.duplicateRecipeIds).toEqual(["oyakodon-basic"]);
      expect(listRecipes(db, null).map((recipe) => recipe.id)).toEqual(["oyakodon-basic"]);
      expect(fs.readFileSync(logPath, "utf8")).toBe(originalLog);
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
    expect(dryRun.results.every((result) => result.validation.valid)).toBe(true);
    expect(dryRun.deletedRecipeIds).toEqual(["oyakodon-basic"]);
    expect(getRecipeDetail(db, "oyakodon-basic")).not.toBeNull();
    db.exec(`CREATE TRIGGER reject_fixture BEFORE INSERT ON recipes
      WHEN NEW.id = 'z-rejected' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`);

    expect(() => syncRecipeFiles(db!, config, recipesDir, { dryRun: false })).toThrow("fixture failure");
    expect(db.inTransaction).toBe(false);
    expect(listRecipes(db, null).map((recipe) => recipe.id)).toEqual(["oyakodon-basic"]);
    expect(fs.readFileSync(logPath, "utf8")).toBe(originalLog);
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
    expect(syncRecipeFiles(db, config, recipesDir, { dryRun: true }).synced).toBe(false);
    expect(syncRecipeFiles(db, config, recipesDir, { dryRun: false }).synced).toBe(true);
    db.close();
    db = openDatabase(config);
    expect(getRecipeDetail(db, "oyakodon-basic")).toBeNull();
    expect(getRecipeDetail(db, "replacement")).not.toBeNull();
    const reopenedJournal = openJournalDatabase(config);
    try {
      expect(listRecipeNotes(reopenedJournal, input.recipeId)).toEqual([expect.objectContaining(input)]);
      expect(reopenedJournal.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
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
