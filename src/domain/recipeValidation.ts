import fs from "node:fs";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import recipeSchema from "../../schemas/recipe.schema.json" with { type: "json" };
import type { IngredientGroup, RecipeAudit, RecipeDocument } from "../shared/recipe";

export interface RecipeValidationReport {
  valid: boolean;
  schemaValid: boolean;
  schemaErrors: string[];
  auditErrors: string[];
  auditWarnings: string[];
  recipe: RecipeDocument | null;
}

let cachedValidator: ValidateFunction<RecipeDocument> | null = null;

export function validateRecipeFile(filePath: string): RecipeValidationReport {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return validateRecipeValue(parsed);
}

export function validateRecipeValue(value: unknown): RecipeValidationReport {
  const validate = getRecipeValidator();
  const schemaValid = validate(value);
  if (!schemaValid) {
    return {
      valid: false,
      schemaValid: false,
      schemaErrors: formatAjvErrors(validate.errors ?? []),
      auditErrors: [],
      auditWarnings: [],
      recipe: null,
    };
  }

  const recipe = value;
  const audit = auditRecipeDocument(recipe);
  return {
    valid: audit.errors.length === 0,
    schemaValid: true,
    schemaErrors: [],
    auditErrors: audit.errors,
    auditWarnings: audit.warnings,
    recipe,
  };
}

export function getRecipeValidator(): ValidateFunction<RecipeDocument> {
  if (cachedValidator) {
    return cachedValidator;
  }
  const schema = loadRecipeSchema();
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  addFormats(ajv);
  cachedValidator = ajv.compile<RecipeDocument>(schema);
  return cachedValidator;
}

function loadRecipeSchema(): AnySchema {
  return recipeSchema as AnySchema;
}

function auditRecipeDocument(recipe: RecipeDocument): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings = collectAuditWarnings(recipe.audit);
  const sourceIds = new Set(recipe.source_refs.map((source) => source.id));
  const ingredientIdList = flattenIngredients(recipe.ingredients).map((ingredient) => ingredient.id);
  const ingredientIds = new Set(ingredientIdList);
  const stepIds = new Set(recipe.steps.map((step) => step.id));
  const nodeIds = new Set(recipe.flow.nodes.map((node) => node.id));

  pushDuplicateErrors("source_refs.id", recipe.source_refs.map((source) => source.id), errors);
  pushDuplicateErrors("ingredients.items.id", ingredientIdList, errors);
  pushDuplicateErrors("steps.id", recipe.steps.map((step) => step.id), errors);
  pushDuplicateErrors("flow.nodes.id", recipe.flow.nodes.map((node) => node.id), errors);
  pushDuplicateErrors("flow.edges.id", recipe.flow.edges.map((edge) => edge.id), errors);

  for (const ingredient of flattenIngredients(recipe.ingredients)) {
    if (ingredient.source_ref_id && !sourceIds.has(ingredient.source_ref_id)) {
      errors.push(`ingredient ${ingredient.id} references missing source_ref_id ${ingredient.source_ref_id}`);
    }
  }

  for (const step of recipe.steps) {
    if (step.source_ref_id && !sourceIds.has(step.source_ref_id)) {
      errors.push(`step ${step.id} references missing source_ref_id ${step.source_ref_id}`);
    }
    for (const ingredientId of step.ingredients ?? []) {
      if (!ingredientIds.has(ingredientId)) {
        errors.push(`step ${step.id} references missing ingredient ${ingredientId}`);
      }
    }
  }

  for (const node of recipe.flow.nodes) {
    if (node.step_id && !stepIds.has(node.step_id)) {
      errors.push(`flow node ${node.id} references missing step_id ${node.step_id}`);
    }
    for (const ingredientId of node.ingredients ?? []) {
      if (!ingredientIds.has(ingredientId)) {
        errors.push(`flow node ${node.id} references missing ingredient ${ingredientId}`);
      }
    }
  }

  for (const edge of recipe.flow.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`flow edge ${edge.id} references missing source node ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`flow edge ${edge.id} references missing target node ${edge.target}`);
    }
  }

  if (recipe.audit.needs_review && recipe.audit.missing_information.length === 0 && recipe.audit.warnings.length === 0) {
    warnings.push("needs_review is true but no warning or missing_information was provided");
  }

  if (recipe.source_refs.length === 0) {
    errors.push("source_refs must describe at least one source note or excerpt");
  }

  return { errors, warnings };
}

export function collectAuditWarnings(audit: RecipeAudit): string[] {
  return [...audit.warnings, ...audit.missing_information.map((item) => `missing: ${item}`)];
}

function flattenIngredients(groups: IngredientGroup[]) {
  return groups.flatMap((group) => group.items);
}

function pushDuplicateErrors(label: string, values: string[], errors: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  for (const value of duplicates) {
    errors.push(`${label} contains duplicate ${value}`);
  }
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const instancePath = error.instancePath || "/";
    return `${instancePath} ${error.message ?? "is invalid"}`;
  });
}
