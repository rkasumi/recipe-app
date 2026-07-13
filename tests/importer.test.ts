import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, openDatabase, type AppConfig, type RecipeDatabase } from "../src/db/database";
import { getRecipeDetail, importRecipeFile, listRecipes, syncRecipeFiles } from "../src/db/recipes";

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
});

function makeConfig(): AppConfig {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-app-"));
  return loadConfig({ DATA_DIR: tempDir });
}
