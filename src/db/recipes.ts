import fs from "node:fs";
import path from "node:path";
import type { AppConfig, RecipeDatabase } from "./database";
import type { RecipeDetail, RecipeDocument, RecipeSummary, SourceRef } from "../shared/recipe";
import { validateRecipeFile, type RecipeValidationReport } from "../domain/recipeValidation";

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

export function listRecipes(db: RecipeDatabase, query: string | null): RecipeSummary[] {
  const trimmed = query?.trim() ?? "";
  const sql = trimmed
    ? `SELECT * FROM recipes
       WHERE title LIKE @q OR ingredient_text LIKE @q OR step_text LIKE @q OR tags_json LIKE @q
       ORDER BY title COLLATE NOCASE`
    : "SELECT * FROM recipes ORDER BY title COLLATE NOCASE";
  const rows = db.prepare(sql).all(trimmed ? { q: `%${trimmed}%` } : {}) as RecipeRow[];
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
  const files = fs
    .readdirSync(recipesDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => path.join(recipesDir, entry));
  return files.map((filePath) => importRecipeFile(db, config, filePath, options));
}

export function upsertRecipe(db: RecipeDatabase, recipe: RecipeDocument): void {
  const importedAt = new Date().toISOString();
  const ingredientText = recipe.ingredients
    .flatMap((group) => group.items.map((item) => `${group.title} ${item.name} ${item.quantity ?? ""}${item.unit ?? ""} ${item.note ?? ""}`))
    .join("\n");
  const stepText = recipe.steps.map((step) => `${step.order}. ${step.title ?? ""} ${step.instruction} ${step.heat ?? ""} ${step.duration ?? ""}`).join("\n");
  const warnings = [
    ...recipe.audit.warnings,
    ...recipe.audit.missing_information.map((item) => `missing: ${item}`),
  ];

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

export function renderSourceRef(source: SourceRef): string {
  return [source.title, source.url, source.note].filter(Boolean).join(" / ");
}

