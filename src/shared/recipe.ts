export type SourceRefType =
  | "youtube_description"
  | "youtube_transcript"
  | "macwhisper_transcript"
  | "book_excerpt"
  | "article_excerpt"
  | "manual_note"
  | "other";

export type FlowNodeKind = "ingredient_group" | "action" | "note" | "wait" | "combine" | "finish";
export type FlowShape = "rectangle" | "pill" | "diamond" | "circle";

export interface RecipeDocument {
  id: string;
  title: string;
  servings: {
    amount?: number;
    unit?: string;
    label: string;
    note?: string;
  };
  source_refs: SourceRef[];
  ingredients: IngredientGroup[];
  steps: RecipeStep[];
  flow: RecipeFlow;
  audit: RecipeAudit;
  tags?: string[];
  updated_at?: string;
}

export interface SourceRef {
  id: string;
  type: SourceRefType;
  title: string;
  url?: string;
  note?: string;
}

export interface IngredientGroup {
  id: string;
  title: string;
  items: Ingredient[];
  note?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  quantity?: string;
  unit?: string;
  note?: string;
  source_ref_id?: string;
}

export interface RecipeStep {
  id: string;
  order: number;
  title?: string;
  instruction: string;
  ingredients?: string[];
  duration?: string;
  heat?: string;
  note?: string;
  source_ref_id?: string;
}

export interface RecipeFlow {
  layout: {
    direction: "LR" | "TB";
    lane_labels?: Record<string, string>;
  };
  nodes: RecipeFlowNode[];
  edges: RecipeFlowEdge[];
}

export interface RecipeFlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  lane: string;
  rank: number;
  shape: FlowShape;
  step_id?: string;
  ingredients?: string[];
  notes?: string[];
  layout_override?: {
    x?: number;
    y?: number;
  };
}

export interface RecipeFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface RecipeAudit {
  needs_review: boolean;
  warnings: string[];
  source_fidelity_notes: string[];
  missing_information: string[];
  generated_by?: string;
  generated_at?: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  servingsLabel: string;
  tags: string[];
  warningCount: number;
  needsReview: boolean;
  updatedAt: string | null;
  importedAt: string;
}

export interface RecipeDetail extends RecipeSummary {
  recipe: RecipeDocument;
}

export interface HealthStatus {
  ok: boolean;
  recipeCount: number;
  dbReady: boolean;
}

