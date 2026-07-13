import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type { RecipeDetail, RecipeDocument, RecipeFlowNode, RecipeStep, RecipeSummary } from "../shared/recipe";

type Tab = "steps" | "ingredients" | "flow";

export function App() {
  const [query, setQuery] = useState("");
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => recipeIdFromHash());
  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [tab, setTab] = useState<Tab>("steps");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cookingMode, setCookingMode] = useState(false);
  const [completedStepIds, setCompletedStepIds] = useState<Set<string>>(new Set());
  const wakeLock = useWakeLock(cookingMode);

  useEffect(() => {
    const handleHashChange = () => setSelectedId(recipeIdFromHash() ?? recipes[0]?.id ?? null);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [recipes]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/recipes?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("recipes fetch failed")))
      .then((payload: { recipes: RecipeSummary[] }) => {
        setRecipes(payload.recipes);
        setError(null);
        setSelectedId((current) => {
          const next = current ?? payload.recipes[0]?.id ?? null;
          if (next && !recipeIdFromHash()) {
            window.history.replaceState(null, "", recipeHash(next));
          }
          return next;
        });
      })
      .catch((nextError: unknown) => {
        if ((nextError as Error).name !== "AbortError") {
          setError("レシピ一覧を読み込めませんでした。");
        }
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/recipes/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("recipe fetch failed")))
      .then((payload: RecipeDetail) => {
        setDetail(payload);
        setSelectedNodeId(null);
        const stepIds = new Set(payload.recipe.steps.map((step) => step.id));
        setCompletedStepIds(new Set([...loadCompletedSteps(payload.id)].filter((stepId) => stepIds.has(stepId))));
        setError(null);
      })
      .catch((nextError: unknown) => {
        if ((nextError as Error).name !== "AbortError") {
          setError("レシピ詳細を読み込めませんでした。");
        }
      });
    return () => controller.abort();
  }, [selectedId]);

  return (
    <main className={cookingMode ? "app-shell cooking-mode" : "app-shell"}>
      <aside className="recipe-list-pane">
        <div className="pane-header">
          <h1>recipe-app</h1>
          <span>{recipes.length}</span>
        </div>
        <label className="search-box">
          <span>検索</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="料理名、材料、工程"
          />
        </label>
        {error ? <div className="status-error">{error}</div> : null}
        <div className="recipe-list">
          {recipes.map((recipe) => (
            <button
              key={recipe.id}
              className={recipe.id === selectedId ? "recipe-row selected" : "recipe-row"}
              type="button"
              onClick={() => {
                navigateToRecipe(recipe.id, setSelectedId);
                setTab("steps");
                setCookingMode(false);
              }}
            >
              <span className="recipe-row-title">{recipe.title}</span>
              <span className="recipe-row-meta">{recipe.servingsLabel}</span>
              <span className="tag-line">{recipe.tags.join(" / ")}</span>
              {recipe.needsReview || recipe.warningCount > 0 ? (
                <span className="warning-chip">{recipe.needsReview ? "要確認" : `${recipe.warningCount}件`}</span>
              ) : null}
            </button>
          ))}
        </div>
      </aside>

      <section className="detail-pane">
        {detail ? (
          <>
            <RecipeHeader recipe={detail.recipe} />
            <nav className="tab-bar" aria-label="recipe views">
              <button className={tab === "steps" ? "active" : ""} type="button" onClick={() => setTab("steps")}>手順</button>
              <button className={tab === "ingredients" ? "active" : ""} type="button" onClick={() => setTab("ingredients")}>材料</button>
              <button className={tab === "flow" ? "active" : ""} type="button" onClick={() => setTab("flow")}>フロー</button>
              <button
                className={cookingMode ? "active cooking-toggle" : "cooking-toggle"}
                type="button"
                onClick={() => {
                  setCookingMode((current) => !current);
                  setTab("steps");
                }}
              >
                {cookingMode ? "調理モード終了" : "調理モード"}
              </button>
            </nav>
            {cookingMode ? (
              <div className="cooking-status" role="status">
                <span>{completedStepIds.size} / {detail.recipe.steps.length} 完了</span>
                <span>{wakeLock.supported ? (wakeLock.active ? "画面スリープ防止中" : "画面スリープ防止は未有効") : "スリープ防止はこの端末では利用できません"}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set<string>();
                    setCompletedStepIds(next);
                    saveCompletedSteps(detail.id, next);
                  }}
                >リセット</button>
              </div>
            ) : null}
            {tab === "steps" ? (
              <StepsView
                steps={detail.recipe.steps}
                cookingMode={cookingMode}
                completedStepIds={completedStepIds}
                onToggleStep={(stepId) => {
                  const next = new Set(completedStepIds);
                  if (next.has(stepId)) {
                    next.delete(stepId);
                  } else {
                    next.add(stepId);
                  }
                  setCompletedStepIds(next);
                  saveCompletedSteps(detail.id, next);
                }}
              />
            ) : null}
            {tab === "ingredients" ? <IngredientsView recipe={detail.recipe} /> : null}
            {tab === "flow" ? (
              <FlowView
                recipe={detail.recipe}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
            ) : null}
          </>
        ) : (
          <div className="empty-state">レシピはまだありません</div>
        )}
      </section>
    </main>
  );
}

function RecipeHeader({ recipe }: { recipe: RecipeDocument }) {
  return (
    <header className="recipe-header">
      <div>
        <h2>{recipe.title}</h2>
        <p>{recipe.servings.label}</p>
      </div>
      <div className="header-meta">
        {(recipe.tags ?? []).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <section className="audit-band">
        {recipe.audit.needs_review ? <strong>要確認</strong> : <strong>監査済み</strong>}
        {recipe.audit.warnings.map((warning) => <span key={warning}>{warning}</span>)}
        {recipe.audit.missing_information.map((item) => <span key={item}>未確認: {item}</span>)}
      </section>
      <section className="source-band">
        {recipe.source_refs.map((source) => (
          <span key={source.id}>{source.title}{source.note ? ` / ${source.note}` : ""}</span>
        ))}
      </section>
    </header>
  );
}

function StepsView({
  steps,
  cookingMode,
  completedStepIds,
  onToggleStep,
}: {
  steps: RecipeStep[];
  cookingMode: boolean;
  completedStepIds: Set<string>;
  onToggleStep: (stepId: string) => void;
}) {
  return (
    <ol className={cookingMode ? "steps-view cooking-steps" : "steps-view"}>
      {steps.map((step) => (
        <li key={step.id} className={completedStepIds.has(step.id) ? "completed" : ""}>
          {cookingMode ? (
            <button
              className="step-check"
              type="button"
              aria-label={`工程${step.order}を${completedStepIds.has(step.id) ? "未完了に戻す" : "完了にする"}`}
              aria-pressed={completedStepIds.has(step.id)}
              onClick={() => onToggleStep(step.id)}
            >{completedStepIds.has(step.id) ? "✓" : step.order}</button>
          ) : <div className="step-number">{step.order}</div>}
          <div>
            <h3>{step.title ?? `工程 ${step.order}`}</h3>
            <p>{step.instruction}</p>
            <div className="step-meta">
              {step.heat ? <span>{step.heat}</span> : null}
              {step.duration ? <span>{step.duration}</span> : null}
              {step.note ? <span>{step.note}</span> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function recipeIdFromHash(): string | null {
  const match = window.location.hash.match(/^#\/recipes\/([^/]+)$/u);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function recipeHash(recipeId: string): string {
  return `#/recipes/${encodeURIComponent(recipeId)}`;
}

function navigateToRecipe(recipeId: string, setSelectedId: (recipeId: string) => void): void {
  const hash = recipeHash(recipeId);
  if (window.location.hash === hash) {
    setSelectedId(recipeId);
  } else {
    window.location.hash = hash;
  }
}

function completedStepsKey(recipeId: string): string {
  return `recipe-app:cooking:${recipeId}`;
}

function loadCompletedSteps(recipeId: string): Set<string> {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(completedStepsKey(recipeId)) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCompletedSteps(recipeId: string, stepIds: Set<string>): void {
  window.sessionStorage.setItem(completedStepsKey(recipeId), JSON.stringify([...stepIds]));
}

function useWakeLock(enabled: boolean): { supported: boolean; active: boolean } {
  const supported = "wakeLock" in navigator;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled || !supported) {
      setActive(false);
      return;
    }
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        setActive(true);
        sentinel.addEventListener("release", () => setActive(false), { once: true });
      } catch {
        setActive(false);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void sentinel?.release();
      setActive(false);
    };
  }, [enabled, supported]);

  return { supported, active };
}

function IngredientsView({ recipe }: { recipe: RecipeDocument }) {
  return (
    <div className="ingredients-view">
      {recipe.ingredients.map((group) => (
        <section key={group.id} className="ingredient-group">
          <h3>{group.title}</h3>
          <table>
            <tbody>
              {group.items.map((item) => (
                <tr key={item.id}>
                  <th>{item.name}</th>
                  <td>{[item.quantity, item.unit].filter(Boolean).join(" ")}</td>
                  <td>{item.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function FlowView({
  recipe,
  selectedNodeId,
  onSelectNode,
}: {
  recipe: RecipeDocument;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const nodes = useMemo(() => recipe.flow.nodes.map((node) => toFlowNode(node, recipe)), [recipe]);
  const edges = useMemo<Edge[]>(() => recipe.flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: false,
  })), [recipe]);
  const selectedNode = recipe.flow.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedStep = selectedNode?.step_id ? recipe.steps.find((step) => step.id === selectedNode.step_id) ?? null : null;

  return (
    <div className="flow-layout">
      <div className="flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => onSelectNode(node.id)}
          onPaneClick={() => onSelectNode(null)}
        >
          <Background />
          <MiniMap />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside className="flow-inspector">
        {selectedNode ? (
          <>
            <h3>{selectedNode.label}</h3>
            <p>{kindLabel(selectedNode.kind)}</p>
            {selectedStep ? <p>{selectedStep.instruction}</p> : null}
            <IngredientBadges recipe={recipe} ids={selectedNode.ingredients ?? []} />
          </>
        ) : (
          <h3>フロー</h3>
        )}
      </aside>
    </div>
  );
}

function IngredientBadges({ recipe, ids }: { recipe: RecipeDocument; ids: string[] }) {
  const ingredients = recipe.ingredients.flatMap((group) => group.items).filter((item) => ids.includes(item.id));
  return (
    <div className="ingredient-badges">
      {ingredients.map((ingredient) => <span key={ingredient.id}>{ingredient.name}</span>)}
    </div>
  );
}

function toFlowNode(node: RecipeFlowNode, recipe: RecipeDocument): Node {
  const laneKeys = Object.keys(recipe.flow.layout.lane_labels ?? {}).length > 0
    ? Object.keys(recipe.flow.layout.lane_labels ?? {})
    : [...new Set(recipe.flow.nodes.map((candidate) => candidate.lane))];
  const laneIndex = Math.max(0, laneKeys.indexOf(node.lane));
  const defaultPosition = recipe.flow.layout.direction === "TB"
    ? { x: laneIndex * 220, y: node.rank * 150 }
    : { x: node.rank * 220, y: laneIndex * 150 };
  const position = {
    x: node.layout_override?.x ?? defaultPosition.x,
    y: node.layout_override?.y ?? defaultPosition.y,
  };
  return {
    id: node.id,
    position,
    data: { label: node.label },
    className: `flow-node ${node.kind} ${node.shape}`,
  };
}

function kindLabel(kind: RecipeFlowNode["kind"]): string {
  switch (kind) {
    case "ingredient_group":
      return "材料";
    case "action":
      return "調理";
    case "note":
      return "注記";
    case "wait":
      return "待ち";
    case "combine":
      return "合流";
    case "finish":
      return "完成";
  }
}
