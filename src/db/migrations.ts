import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      servings_label TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      ingredient_text TEXT NOT NULL,
      step_text TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      recipe_json TEXT NOT NULL,
      updated_at TEXT,
      imported_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes(title);
    CREATE INDEX IF NOT EXISTS idx_recipes_needs_review ON recipes(needs_review);
  `);
}

export function runJournalMigrations(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS recipe_notes (
      recipe_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('recipe', 'ingredient', 'step')),
      target_id TEXT NOT NULL,
      note TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (recipe_id, target_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_recipe_notes_recipe_id ON recipe_notes(recipe_id);
  `);
}
