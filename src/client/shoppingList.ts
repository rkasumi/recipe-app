import type { RecipeDetail } from "../shared/recipe";

export interface ShoppingListEntry {
  recipeId: string;
  recipeTitle: string;
  groupTitle: string;
  quantityLabel: string;
}

export interface ShoppingListItem {
  name: string;
  entries: ShoppingListEntry[];
}

export function buildShoppingList(
  recipes: Array<Pick<RecipeDetail, "id" | "title" | "recipe">>,
): ShoppingListItem[] {
  const items = new Map<string, ShoppingListItem>();
  for (const detail of recipes) {
    for (const group of detail.recipe.ingredients) {
      for (const ingredient of group.items) {
        const key = ingredient.name.trim().toLocaleLowerCase("ja");
        const item = items.get(key) ?? { name: ingredient.name.trim(), entries: [] };
        item.entries.push({
          recipeId: detail.id,
          recipeTitle: detail.title,
          groupTitle: group.title,
          quantityLabel: [ingredient.quantity, ingredient.unit, ingredient.note].filter(Boolean).join(" ") || "分量記載なし",
        });
        items.set(key, item);
      }
    }
  }
  return [...items.values()].sort((left, right) => left.name.localeCompare(right.name, "ja"));
}
