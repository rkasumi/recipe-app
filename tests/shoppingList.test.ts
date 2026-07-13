import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildShoppingList } from "../src/client/shoppingList";
import type { RecipeDetail, RecipeDocument } from "../src/shared/recipe";

const fixturePath = path.resolve("fixtures/recipes/oyakodon.json");

describe("shopping list", () => {
  it("groups ingredients by name while preserving each recipe quantity", () => {
    const first = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as RecipeDocument;
    const second = structuredClone(first);
    second.id = "oyakodon-large";
    second.title = "親子丼 大盛り";
    second.ingredients[0].items[0].quantity = "400";

    const items = buildShoppingList([
      toDetail(first),
      toDetail(second),
    ]);
    const chicken = items.find((item) => item.name === "鶏もも肉");

    expect(chicken?.entries).toEqual([
      expect.objectContaining({ recipeTitle: "親子丼", quantityLabel: "200 g" }),
      expect.objectContaining({ recipeTitle: "親子丼 大盛り", quantityLabel: "400 g" }),
    ]);
  });
});

function toDetail(recipe: RecipeDocument): RecipeDetail {
  return {
    id: recipe.id,
    title: recipe.title,
    servingsLabel: recipe.servings.label,
    tags: recipe.tags ?? [],
    warningCount: 0,
    needsReview: false,
    updatedAt: null,
    importedAt: "2026-07-13T00:00:00Z",
    recipe,
  };
}
