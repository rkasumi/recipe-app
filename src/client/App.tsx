import { createContext, Fragment, useContext, useEffect, useMemo, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type { RecipeDetail, RecipeDocument, RecipeFlowNode, RecipeNote, RecipeNoteTarget, RecipeStep, RecipeSummary } from "../shared/recipe";
import { buildShoppingList } from "./shoppingList";

type Tab = "steps" | "ingredients" | "flow";

interface PersonalNotesContextValue {
  notes: RecipeNote[];
  writable: boolean;
  save: (targetType: RecipeNoteTarget, targetId: string, note: string) => Promise<void>;
}

const PersonalNotesContext = createContext<PersonalNotesContextValue>({
  notes: [],
  writable: false,
  save: async () => undefined,
});

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
  const [shoppingRecipeIds, setShoppingRecipeIds] = useState<Set<string>>(new Set());
  const [shoppingListOpen, setShoppingListOpen] = useState(false);
  const [personalNotes, setPersonalNotes] = useState<RecipeNote[]>([]);
  const [notesWritable, setNotesWritable] = useState(false);
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
    const controller = new AbortController();
    fetch("/api/capabilities", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("capabilities fetch failed")))
      .then((payload: { notesWritable: boolean }) => setNotesWritable(payload.notesWritable))
      .catch(() => setNotesWritable(false));
    return () => controller.abort();
  }, []);

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

  useEffect(() => {
    setPersonalNotes([]);
    if (!selectedId || !notesWritable) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/recipes/${encodeURIComponent(selectedId)}/notes`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("notes fetch failed")))
      .then((payload: { notes: RecipeNote[] }) => setPersonalNotes(payload.notes))
      .catch((nextError: unknown) => {
        if ((nextError as Error).name !== "AbortError") {
          setPersonalNotes([]);
        }
      });
    return () => controller.abort();
  }, [notesWritable, selectedId]);

  const savePersonalNote = async (targetType: RecipeNoteTarget, targetId: string, note: string): Promise<void> => {
    if (!selectedId) {
      throw new Error("recipe is not selected");
    }
    const response = await fetch(`/api/recipes/${encodeURIComponent(selectedId)}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId, note }),
    });
    if (!response.ok) {
      throw new Error("note save failed");
    }
    const payload = await response.json() as { note: RecipeNote | null };
    setPersonalNotes((current) => {
      const next = current.filter((item) => item.targetType !== targetType || item.targetId !== targetId);
      return payload.note ? [...next, payload.note] : next;
    });
  };

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
          <small>空白で区切ると、すべてを含むレシピに絞り込みます。</small>
        </label>
        <div className="list-actions">
          <button
            type="button"
            disabled={recipes.length === 0}
            onClick={() => {
              const recipe = pickRandomRecipe(recipes);
              if (recipe) {
                navigateToRecipe(recipe.id, setSelectedId);
                setShoppingListOpen(false);
                setCookingMode(false);
              }
            }}
          >おまかせ</button>
          <button
            type="button"
            disabled={shoppingRecipeIds.size === 0}
            onClick={() => {
              setShoppingListOpen(true);
              setCookingMode(false);
            }}
          >買い物リスト ({shoppingRecipeIds.size})</button>
        </div>
        {error ? <div className="status-error">{error}</div> : null}
        <div className="recipe-list">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="recipe-row-wrap">
              <button
                className={recipe.id === selectedId ? "recipe-row selected" : "recipe-row"}
                type="button"
                onClick={() => {
                  navigateToRecipe(recipe.id, setSelectedId);
                  setTab("steps");
                  setCookingMode(false);
                  setShoppingListOpen(false);
                }}
              >
                <span className="recipe-row-title">{recipe.title}</span>
                <span className="recipe-row-meta">{recipe.servingsLabel}</span>
                <span className="tag-line">{recipe.tags.join(" / ")}</span>
                {recipe.needsReview || recipe.warningCount > 0 ? (
                  <span className="warning-chip">{recipe.needsReview ? "要確認" : `${recipe.warningCount}件`}</span>
                ) : null}
              </button>
              <button
                className={shoppingRecipeIds.has(recipe.id) ? "shopping-pick selected" : "shopping-pick"}
                type="button"
                aria-pressed={shoppingRecipeIds.has(recipe.id)}
                onClick={() => setShoppingRecipeIds(toggleSetValue(shoppingRecipeIds, recipe.id))}
              >{shoppingRecipeIds.has(recipe.id) ? "買い物から外す" : "買い物に追加"}</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="detail-pane">
        {shoppingListOpen ? (
          <ShoppingListView
            recipeIds={[...shoppingRecipeIds]}
            onRemove={(recipeId) => {
              const next = toggleSetValue(shoppingRecipeIds, recipeId);
              setShoppingRecipeIds(next);
              if (next.size === 0) {
                setShoppingListOpen(false);
              }
            }}
            onClose={() => setShoppingListOpen(false)}
          />
        ) : detail ? (
          <PersonalNotesContext.Provider value={{ notes: personalNotes, writable: notesWritable, save: savePersonalNote }}>
            <RecipeHeader recipe={detail.recipe} />
            <PersonalNoteEditor targetType="recipe" targetId={detail.id} label="このレシピの自分メモ" />
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
          </PersonalNotesContext.Provider>
        ) : (
          <div className="empty-state">レシピはまだありません</div>
        )}
      </section>
    </main>
  );
}

function ShoppingListView({
  recipeIds,
  onRemove,
  onClose,
}: {
  recipeIds: string[];
  onRemove: (recipeId: string) => void;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<RecipeDetail[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(recipeIds.map((recipeId) => (
      fetch(`/api/recipes/${encodeURIComponent(recipeId)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<RecipeDetail> : Promise.reject(new Error("recipe fetch failed")))
    )))
      .then((payload) => {
        setDetails(payload);
        setError(null);
      })
      .catch((nextError: unknown) => {
        if ((nextError as Error).name !== "AbortError") {
          setError("買い物リストを作成できませんでした。");
        }
      });
    return () => controller.abort();
  }, [recipeIds.join("\u0000")]);

  const items = useMemo(() => buildShoppingList(details), [details]);
  return (
    <div className="shopping-list-view">
      <header>
        <div>
          <h2>買い物リスト</h2>
          <p>同じ名前の材料はまとめ、分量はレシピごとに表示します。</p>
        </div>
        <button type="button" onClick={onClose}>レシピに戻る</button>
      </header>
      <div className="shopping-recipes">
        {details.map((detail) => (
          <span key={detail.id}>
            {detail.title}
            <button type="button" aria-label={`${detail.title}を買い物リストから外す`} onClick={() => onRemove(detail.id)}>×</button>
          </span>
        ))}
      </div>
      {error ? <div className="status-error">{error}</div> : null}
      <ul className="shopping-items">
        {items.map((item) => (
          <li key={item.name}>
            <strong>{item.name}</strong>
            <ul>
              {item.entries.map((entry) => (
                <li key={`${entry.recipeId}:${entry.groupTitle}:${entry.quantityLabel}`}>
                  <span>{entry.quantityLabel}</span>
                  <small>{entry.recipeTitle} / {entry.groupTitle}</small>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toggleSetValue(values: Set<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function pickRandomRecipe(recipes: RecipeSummary[]): RecipeSummary | null {
  if (recipes.length === 0) {
    return null;
  }
  return recipes[Math.floor(Math.random() * recipes.length)];
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
            <PersonalNoteEditor targetType="step" targetId={step.id} label="この工程の自分メモ" compact />
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
                <Fragment key={item.id}>
                  <tr>
                    <th>{item.name}</th>
                    <td>{[item.quantity, item.unit].filter(Boolean).join(" ")}</td>
                    <td>{item.note ?? ""}</td>
                  </tr>
                  <tr className="ingredient-personal-note">
                    <td colSpan={3}>
                      <PersonalNoteEditor targetType="ingredient" targetId={item.id} label={`${item.name}の自分メモ`} compact />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function PersonalNoteEditor({
  targetType,
  targetId,
  label,
  compact = false,
}: {
  targetType: RecipeNoteTarget;
  targetId: string;
  label: string;
  compact?: boolean;
}) {
  const context = useContext(PersonalNotesContext);
  const savedNote = context.notes.find((item) => item.targetType === targetType && item.targetId === targetId)?.note ?? "";
  const [value, setValue] = useState(savedNote);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setValue(savedNote);
    setStatus("idle");
  }, [savedNote, targetId, targetType]);

  if (!context.writable && !savedNote) {
    return null;
  }

  return (
    <section className={compact ? "personal-note compact" : "personal-note"}>
      <label>
        <span>{label}</span>
        <textarea
          value={value}
          maxLength={2_000}
          rows={compact ? 2 : 3}
          readOnly={!context.writable}
          onChange={(event) => {
            setValue(event.target.value);
            setStatus("idle");
          }}
        />
      </label>
      {context.writable ? (
        <div>
          <button
            type="button"
            disabled={status === "saving" || value === savedNote}
            onClick={() => {
              setStatus("saving");
              context.save(targetType, targetId, value)
                .then(() => setStatus("saved"))
                .catch(() => setStatus("error"));
            }}
          >保存</button>
          {status === "saved" ? <small>保存しました</small> : null}
          {status === "error" ? <small className="status-error">保存できませんでした</small> : null}
        </div>
      ) : <small>書き込みは無効です</small>}
    </section>
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
