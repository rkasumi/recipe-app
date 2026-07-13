import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  recipesDir: string;
  dbPath: string;
}

export type RecipeDatabase = Database.Database;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.DATA_DIR ?? "data");
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535: ${env.PORT ?? "8080"}`);
  }
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    dataDir,
    recipesDir: path.resolve(env.RECIPES_DIR ?? path.join(dataDir, "recipes")),
    dbPath: path.resolve(env.RECIPE_DB_PATH ?? path.join(dataDir, "recipes.sqlite")),
  };
}

export function openDatabase(config: AppConfig): RecipeDatabase {
  ensureDataDirs(config);
  const db = new Database(config.dbPath);
  runMigrations(db);
  return db;
}

export function ensureDataDirs(config: AppConfig): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.recipesDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}
