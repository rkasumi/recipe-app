import path from "node:path";
import { loadConfig, openDatabase, type AppConfig } from "../db/database";
import { countRecipes, importAllRecipeFiles, importRecipeFile, type ImportResult } from "../db/recipes";
import { validateRecipeFile } from "../domain/recipeValidation";

interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Record<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.options.help === true) {
    printUsage();
    return;
  }

  switch (parsed.command) {
    case "validate":
      commandValidate(parsed);
      return;
    case "dry-run":
      commandImportOne(parsed, true);
      return;
    case "import":
      commandImportOne(parsed, getBooleanOption(parsed, "dry-run"));
      return;
    case "import-all":
      commandImportAll(parsed);
      return;
    case "status":
      commandStatus(parsed);
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

function commandValidate(parsed: ParsedArgs): void {
  const filePath = requirePath(parsed, "validate requires a recipe JSON path");
  const report = validateRecipeFile(filePath);
  printValidation(filePath, report.valid, report.schemaErrors, report.auditErrors, report.auditWarnings);
  if (!report.valid) {
    process.exitCode = 1;
  }
}

function commandImportOne(parsed: ParsedArgs, dryRun: boolean): void {
  const filePath = requirePath(parsed, "import requires a recipe JSON path");
  const config = configFromArgs(parsed);
  const db = openDatabase(config);
  const result = importRecipeFile(db, config, filePath, { dryRun });
  printImportResults([result]);
  db.close();
  if (!result.validation.valid) {
    process.exitCode = 1;
  }
}

function commandImportAll(parsed: ParsedArgs): void {
  const config = configFromArgs(parsed);
  const recipesDir = getStringOption(parsed, "recipes-dir") ?? config.recipesDir;
  const db = openDatabase(config);
  const results = importAllRecipeFiles(db, config, recipesDir, { dryRun: getBooleanOption(parsed, "dry-run") });
  printImportResults(results);
  db.close();
  if (results.some((result) => !result.validation.valid)) {
    process.exitCode = 1;
  }
}

function commandStatus(parsed: ParsedArgs): void {
  const config = configFromArgs(parsed);
  const db = openDatabase(config);
  console.log(JSON.stringify({
    dbPath: config.dbPath,
    recipesDir: config.recipesDir,
    recipeCount: countRecipes(db),
  }, null, 2));
  db.close();
}

function configFromArgs(parsed: ParsedArgs): AppConfig {
  const env = { ...process.env };
  const dataDir = getStringOption(parsed, "data-dir");
  const recipesDir = getStringOption(parsed, "recipes-dir");
  const dbPath = getStringOption(parsed, "db");
  if (dataDir) {
    env.DATA_DIR = path.resolve(dataDir);
  }
  if (recipesDir) {
    env.RECIPES_DIR = path.resolve(recipesDir);
  }
  if (dbPath) {
    env.RECIPE_DB_PATH = path.resolve(dbPath);
  }
  return loadConfig(env);
}

function parseArgs(args: string[]): ParsedArgs {
  const [command = "", ...rest] = args;
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const option = token.slice(2);
    if (option === "help" || option === "dry-run") {
      options[option] = true;
      continue;
    }
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      options[option] = next;
      index += 1;
    } else {
      throw new Error(`Option --${option} requires a value`);
    }
  }

  return { command, positionals, options };
}

function requirePath(parsed: ParsedArgs, message: string): string {
  const filePath = parsed.positionals[0];
  if (!filePath) {
    throw new Error(message);
  }
  return path.resolve(filePath);
}

function getStringOption(parsed: ParsedArgs, key: string): string | null {
  const value = parsed.options[key];
  return typeof value === "string" ? value : null;
}

function getBooleanOption(parsed: ParsedArgs, key: string): boolean {
  return parsed.options[key] === true;
}

function printImportResults(results: ImportResult[]): void {
  for (const result of results) {
    printValidation(result.filePath, result.validation.valid, result.validation.schemaErrors, result.validation.auditErrors, result.validation.auditWarnings);
    if (result.validation.valid) {
      const action = result.dryRun ? "dry-run" : "imported";
      console.log(`${action}: ${result.validation.recipe?.id ?? result.filePath}`);
    }
  }
}

function printValidation(filePath: string, valid: boolean, schemaErrors: string[], auditErrors: string[], auditWarnings: string[]): void {
  console.log(`${valid ? "ok" : "ng"}: ${filePath}`);
  for (const error of schemaErrors) {
    console.log(`schema error: ${error}`);
  }
  for (const error of auditErrors) {
    console.log(`audit error: ${error}`);
  }
  for (const warning of auditWarnings) {
    console.log(`audit warning: ${warning}`);
  }
}

function printUsage(): void {
  console.log(`recipe-app CLI

Commands:
  validate <recipe.json>
  dry-run <recipe.json> [--data-dir DIR]
  import <recipe.json> [--data-dir DIR] [--dry-run]
  import-all [--recipes-dir DIR] [--data-dir DIR] [--dry-run]
  status [--data-dir DIR]
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
