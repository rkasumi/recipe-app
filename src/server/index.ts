import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler } from "express";
import { loadConfig, openDatabase, openJournalDatabase, type AppConfig, type RecipeDatabase } from "../db/database";
import { listRecipeNotes, saveRecipeNote } from "../db/notes";
import { countRecipes, getRecipeDetail, listRecipes } from "../db/recipes";
import type { HealthStatus, RecipeDetail, RecipeNoteTarget, RecipeSummary } from "../shared/recipe";

export interface AppContext {
  config: AppConfig;
  db: RecipeDatabase;
  journalDb: RecipeDatabase;
  clientDist?: string;
}

export function createServer(context: AppContext): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  app.get(["/health", "/healthz"], (_req, res) => {
    res.json(getHealthStatus(context.db));
  });

  app.get("/api/recipes", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : null;
    res.json(getRecipeListResponse(context.db, query));
  });

  app.get("/api/capabilities", (_req, res) => {
    res.json({ notesWritable: context.config.enableWrites });
  });

  app.get("/api/recipes/:id/notes", (req, res) => {
    if (!getRecipeDetail(context.db, req.params.id)) {
      res.status(404).json({ error: "recipe_not_found" });
      return;
    }
    res.json({ notes: listRecipeNotes(context.journalDb, req.params.id) });
  });

  app.put("/api/recipes/:id/notes", (req, res) => {
    if (!context.config.enableWrites) {
      res.status(403).json({ error: "writes_disabled" });
      return;
    }
    const detail = getRecipeDetail(context.db, req.params.id);
    if (!detail) {
      res.status(404).json({ error: "recipe_not_found" });
      return;
    }
    const input = parseRecipeNoteInput(req.body);
    if (!input || !noteTargetExists(detail, input.targetType, input.targetId)) {
      res.status(400).json({ error: "invalid_recipe_note" });
      return;
    }
    const note = saveRecipeNote(context.journalDb, {
      recipeId: detail.id,
      targetType: input.targetType,
      targetId: input.targetId,
      note: input.note,
    });
    res.json({ note });
  });

  app.get("/api/recipes/:id", (req, res) => {
    const detail = getRecipeDetailResponse(context.db, req.params.id);
    if (!detail) {
      res.status(404).json({ error: "recipe_not_found" });
      return;
    }
    res.json(detail);
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const clientDist = context.clientDist ?? path.resolve(process.cwd(), "dist/client");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes("/assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(errorHandler);
  return app;
}

export function getHealthStatus(db: RecipeDatabase): HealthStatus {
  return {
    ok: true,
    recipeCount: countRecipes(db),
    dbReady: true,
  };
}

export function getRecipeListResponse(db: RecipeDatabase, query: string | null): { recipes: RecipeSummary[] } {
  return { recipes: listRecipes(db, query) };
}

export function getRecipeDetailResponse(db: RecipeDatabase, id: string): RecipeDetail | null {
  return getRecipeDetail(db, id);
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  console.error("Unhandled request error", error);
  res.status(500).json({ error: "internal_error" });
};

if (isMainModule()) {
  const config = loadConfig();
  const db = openDatabase(config);
  const journalDb = openJournalDatabase(config);
  const app = createServer({ config, db, journalDb });
  app.listen(config.port, config.host, () => {
    console.log(`recipe-app listening on ${config.host}:${config.port}`);
  });
}

function parseRecipeNoteInput(value: unknown): { targetType: RecipeNoteTarget; targetId: string; note: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (
    (input.targetType !== "recipe" && input.targetType !== "ingredient" && input.targetType !== "step")
    || typeof input.targetId !== "string"
    || input.targetId.length === 0
    || typeof input.note !== "string"
    || input.note.length > 2_000
  ) {
    return null;
  }
  return { targetType: input.targetType, targetId: input.targetId, note: input.note };
}

function noteTargetExists(detail: RecipeDetail, targetType: RecipeNoteTarget, targetId: string): boolean {
  switch (targetType) {
    case "recipe":
      return targetId === detail.id;
    case "ingredient":
      return detail.recipe.ingredients.some((group) => group.items.some((item) => item.id === targetId));
    case "step":
      return detail.recipe.steps.some((step) => step.id === targetId);
  }
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
