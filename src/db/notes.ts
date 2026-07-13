import type { RecipeDatabase } from "./database";
import type { RecipeNote, RecipeNoteTarget } from "../shared/recipe";

interface RecipeNoteRow {
  recipe_id: string;
  target_type: RecipeNoteTarget;
  target_id: string;
  note: string;
  updated_at: string;
}

export function listRecipeNotes(db: RecipeDatabase, recipeId: string): RecipeNote[] {
  const rows = db.prepare(`
    SELECT recipe_id, target_type, target_id, note, updated_at
    FROM recipe_notes
    WHERE recipe_id = ?
    ORDER BY target_type, target_id
  `).all(recipeId) as RecipeNoteRow[];
  return rows.map(rowToRecipeNote);
}

export function saveRecipeNote(
  db: RecipeDatabase,
  input: { recipeId: string; targetType: RecipeNoteTarget; targetId: string; note: string },
): RecipeNote | null {
  const note = input.note.trim();
  if (!note) {
    db.prepare(`
      DELETE FROM recipe_notes
      WHERE recipe_id = @recipeId AND target_type = @targetType AND target_id = @targetId
    `).run(input);
    return null;
  }

  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO recipe_notes (recipe_id, target_type, target_id, note, updated_at)
    VALUES (@recipeId, @targetType, @targetId, @note, @updatedAt)
    ON CONFLICT(recipe_id, target_type, target_id) DO UPDATE SET
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run({ ...input, note, updatedAt });
  return { ...input, note, updatedAt };
}

function rowToRecipeNote(row: RecipeNoteRow): RecipeNote {
  return {
    recipeId: row.recipe_id,
    targetType: row.target_type,
    targetId: row.target_id,
    note: row.note,
    updatedAt: row.updated_at,
  };
}
