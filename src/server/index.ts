import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler } from "express";
import { loadConfig, openDatabase, type AppConfig, type RecipeDatabase } from "../db/database";
import { countRecipes, getRecipeDetail, listRecipes } from "../db/recipes";
import type { HealthStatus, RecipeDetail, RecipeSummary } from "../shared/recipe";

export interface AppContext {
  config: AppConfig;
  db: RecipeDatabase;
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

  app.get("/api/recipes/:id", (req, res) => {
    const detail = getRecipeDetailResponse(context.db, req.params.id);
    if (!detail) {
      res.status(404).json({ error: "recipe_not_found" });
      return;
    }
    res.json(detail);
  });

  const clientDist = path.resolve(process.cwd(), "dist/client");
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
  const message = error instanceof Error ? error.message : "unknown_error";
  res.status(500).json({ error: "internal_error", message });
};

if (isMainModule()) {
  const config = loadConfig();
  const db = openDatabase(config);
  const app = createServer({ config, db });
  app.listen(config.port, config.host, () => {
    console.log(`recipe-app listening on ${config.host}:${config.port}`);
  });
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
