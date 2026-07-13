import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateRecipeFile, validateRecipeValue } from "../src/domain/recipeValidation";
import type { RecipeDocument } from "../src/shared/recipe";

const fixturePath = path.resolve("fixtures/recipes/oyakodon.json");

describe("recipe validation", () => {
  it("sample recipe passes schema and source/flow audit", () => {
    const report = validateRecipeFile(fixturePath);

    expect(report.valid).toBe(true);
    expect(report.schemaErrors).toEqual([]);
    expect(report.auditErrors).toEqual([]);
    expect(report.auditWarnings).toContain("三つ葉は任意材料として扱った。");
  });

  it("detects flow references that schema alone cannot catch", () => {
    const recipe = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RecipeDocument;
    recipe.flow.edges[0].target = "missing-node";

    const report = validateRecipeValue(recipe);

    expect(report.schemaValid).toBe(true);
    expect(report.valid).toBe(false);
    expect(report.auditErrors).toContain("flow edge edge-sauce-simmer references missing target node missing-node");
  });

  it("rejects invalid URI and date-time formats", () => {
    const recipe = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RecipeDocument;
    recipe.updated_at = "not-a-date";
    recipe.source_refs[0].url = "not a URI";

    const report = validateRecipeValue(recipe);

    expect(report.schemaValid).toBe(false);
    expect(report.schemaErrors).toEqual(expect.arrayContaining([
      expect.stringContaining("format \"date-time\""),
      expect.stringContaining("format \"uri\""),
    ]));
  });
});
