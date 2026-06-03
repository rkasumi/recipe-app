import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, openDatabase, type RecipeDatabase } from "../src/db/database";
import { importRecipeFile } from "../src/db/recipes";
import { getHealthStatus, getRecipeDetailResponse, getRecipeListResponse } from "../src/server/index";

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
});
