import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRecipeFile, validateRecipeValue } from "../src/domain/recipeValidation";
import type { RecipeDocument } from "../src/shared/recipe";

const fixturePath = path.resolve("fixtures/recipes/oyakodon.json");

describe("recipe validation", () => {
  it("sample recipe passes schema and source/flow audit", () => {
    const report = validateRecipeFile(fixturePath);

    assert.equal(report.valid, true);
    assert.deepEqual(report.schemaErrors, []);
    assert.deepEqual(report.auditErrors, []);
    assert.ok(report.auditWarnings.includes("三つ葉は任意材料として扱った。"));
  });

  it("detects flow references that schema alone cannot catch", () => {
    const recipe = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RecipeDocument;
    recipe.flow.edges[0].target = "missing-node";

    const report = validateRecipeValue(recipe);

    assert.equal(report.schemaValid, true);
    assert.equal(report.valid, false);
    assert.ok(report.auditErrors.includes("flow edge edge-sauce-simmer references missing target node missing-node"));
  });

  it("rejects invalid URI and date-time formats", () => {
    const recipe = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RecipeDocument;
    recipe.updated_at = "not-a-date";
    recipe.source_refs[0].url = "not a URI";

    const report = validateRecipeValue(recipe);

    assert.equal(report.schemaValid, false);
    assert.ok(report.schemaErrors.some((message) => message.includes('format "date-time"')));
    assert.ok(report.schemaErrors.some((message) => message.includes('format "uri"')));
  });
});
