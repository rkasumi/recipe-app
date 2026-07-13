import fs from "node:fs";
import path from "node:path";
import type { AppConfig, RecipeDatabase } from "./database";
import type { RecipeDetail, RecipeDocument, RecipeSummary } from "../shared/recipe";
import { collectAuditWarnings, validateRecipeFile, type RecipeValidationReport } from "../domain/recipeValidation";

interface RecipeRow {
  id: string;
  title: string;
  servings_label: string;
  tags_json: string;
  source_refs_json: string;
  warnings_json: string;
  needs_review: number;
  recipe_json: string;
  updated_at: string | null;
  imported_at: string;
}

export interface ImportResult {
  filePath: string;
  imported: boolean;
  dryRun: boolean;
  validation: RecipeValidationReport;
}

export interface SyncResult {
  results: ImportResult[];
  dryRun: boolean;
  synced: boolean;
  duplicateRecipeIds: string[];
  deletedRecipeIds: string[];
}

export function listRecipes(db: RecipeDatabase, query: string | null): RecipeSummary[] {
  const trimmed = query?.trim() ?? "";
  const terms = trimmed ? trimmed.split(/\s+/u) : [];
  const searchableColumns = ["title", "ingredient_text", "step_text", "tags_json"];
  const where = terms.map((_term, index) => (
    `(${searchableColumns.map((column) => `${column} LIKE @q${index} ESCAPE '\\'`).join(" OR ")})`
  )).join(" AND ");
  const sql = `SELECT * FROM recipes${where ? ` WHERE ${where}` : ""} ORDER BY title COLLATE NOCASE`;
  const parameters = Object.fromEntries(terms.map((term, index) => [`q${index}`, `%${escapeLike(term)}%`]));
  const rows = db.prepare(sql).all(parameters) as RecipeRow[];
  return rows.map(rowToSummary);
}

export function getRecipeDetail(db: RecipeDatabase, id: string): RecipeDetail | null {
  const row = db.prepare("SELECT * FROM recipes WHERE id = ?").get(id) as RecipeRow | undefined;
  if (!row) {
    return null;
  }
  return {
    ...rowToSummary(row),
    recipe: JSON.parse(row.recipe_json) as RecipeDocument,
  };
}

export function countRecipes(db: RecipeDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM recipes").get() as { count: number };
  return row.count;
}

export function importRecipeFile(db: RecipeDatabase, config: AppConfig, filePath: string, options: { dryRun: boolean }): ImportResult {
  const validation = validateRecipeFile(filePath);
  if (!validation.valid || !validation.recipe) {
    return {
      filePath,
      imported: false,
      dryRun: options.dryRun,
      validation,
    };
  }

  if (!options.dryRun) {
    upsertRecipe(db, validation.recipe);
    appendImportLog(config, {
      recipeId: validation.recipe.id,
      filePath,
      importedAt: new Date().toISOString(),
      warnings: validation.auditWarnings,
    });
  }

  return {
    filePath,
    imported: !options.dryRun,
    dryRun: options.dryRun,
    validation,
  };
}

export function importAllRecipeFiles(
  db: RecipeDatabase,
  config: AppConfig,
  recipesDir: string,
  options: { dryRun: boolean },
): ImportResult[] {
  const files = listRecipeFiles(recipesDir);
  return files.map((filePath) => importRecipeFile(db, config, filePath, options));
}

export function syncRecipeFiles(
  db: RecipeDatabase,
  config: AppConfig,
  recipesDir: string,
  options: { dryRun: boolean },
): SyncResult {
  const results = listRecipeFiles(recipesDir).map((filePath): ImportResult => {
    const validation = validateRecipeFile(filePath);
    return { filePath, imported: false, dryRun: options.dryRun, validation };
  });
  if (results.length === 0) {
    throw new Error(`sync requires at least one recipe JSON: ${recipesDir}`);
  }
  const recipeIds = results.flatMap((result) => result.validation.recipe?.id ?? []);
  const duplicateRecipeIds = findDuplicates(recipeIds);
  const targetIds = new Set(recipeIds);
  const currentIds = (db.prepare("SELECT id FROM recipes").all() as Array<{ id: string }>).map((row) => row.id);
  const deletedRecipeIds = currentIds.filter((id) => !targetIds.has(id));
  const valid = results.every((result) => result.validation.valid) && duplicateRecipeIds.length === 0;

  if (!valid || options.dryRun) {
    return { results, dryRun: options.dryRun, synced: false, duplicateRecipeIds, deletedRecipeIds };
  }

  const importedAt = new Date().toISOString();
  db.transaction(() => {
    db.exec("DELETE FROM recipes");
    for (const result of results) {
      upsertRecipe(db, result.validation.recipe!, importedAt);
    }
  })();
  for (const result of results) {
    result.imported = true;
    appendImportLog(config, {
      recipeId: result.validation.recipe!.id,
      filePath: result.filePath,
      importedAt,
      warnings: result.validation.auditWarnings,
    });
  }

  return { results, dryRun: false, synced: true, duplicateRecipeIds: [], deletedRecipeIds };
}

export function upsertRecipe(db: RecipeDatabase, recipe: RecipeDocument, importedAt = new Date().toISOString()): void {
  const ingredientText = recipe.ingredients
    .flatMap((group) => group.items.map((item) => `${group.title} ${item.name} ${item.quantity ?? ""}${item.unit ?? ""} ${item.note ?? ""}`))
    .join("\n");
  const stepText = recipe.steps.map((step) => `${step.order}. ${step.title ?? ""} ${step.instruction} ${step.heat ?? ""} ${step.duration ?? ""}`).join("\n");
  const warnings = collectAuditWarnings(recipe.audit);

  db.prepare(`
    INSERT INTO recipes (
      id,
      title,
      servings_label,
      tags_json,
      ingredient_text,
      step_text,
      source_refs_json,
      warnings_json,
      needs_review,
      recipe_json,
      updated_at,
      imported_at
    ) VALUES (
      @id,
      @title,
      @servingsLabel,
      @tagsJson,
      @ingredientText,
      @stepText,
      @sourceRefsJson,
      @warningsJson,
      @needsReview,
      @recipeJson,
      @updatedAt,
      @importedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      servings_label = excluded.servings_label,
      tags_json = excluded.tags_json,
      ingredient_text = excluded.ingredient_text,
      step_text = excluded.step_text,
      source_refs_json = excluded.source_refs_json,
      warnings_json = excluded.warnings_json,
      needs_review = excluded.needs_review,
      recipe_json = excluded.recipe_json,
      updated_at = excluded.updated_at,
      imported_at = excluded.imported_at
  `).run({
    id: recipe.id,
    title: recipe.title,
    servingsLabel: recipe.servings.label,
    tagsJson: JSON.stringify(recipe.tags ?? []),
    ingredientText,
    stepText,
    sourceRefsJson: JSON.stringify(recipe.source_refs),
    warningsJson: JSON.stringify(warnings),
    needsReview: recipe.audit.needs_review ? 1 : 0,
    recipeJson: JSON.stringify(recipe),
    updatedAt: recipe.updated_at ?? null,
    importedAt,
  });
}

function listRecipeFiles(recipesDir: string): string[] {
  return fs
    .readdirSync(recipesDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => path.join(recipesDir, entry));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function rowToSummary(row: RecipeRow): RecipeSummary {
  const warnings = JSON.parse(row.warnings_json) as string[];
  return {
    id: row.id,
    title: row.title,
    servingsLabel: row.servings_label,
    tags: JSON.parse(row.tags_json) as string[],
    warningCount: warnings.length,
    needsReview: row.needs_review === 1,
    updatedAt: row.updated_at,
    importedAt: row.imported_at,
  };
}

function appendImportLog(config: AppConfig, entry: { recipeId: string; filePath: string; importedAt: string; warnings: string[] }): void {
  const logsDir = path.join(config.dataDir, "import-logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, "imports.jsonl");
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}
