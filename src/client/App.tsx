import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type { RecipeDetail, RecipeDocument, RecipeFlowNode, RecipeStep, RecipeSummary } from "../shared/recipe";

type Tab = "steps" | "ingredients" | "flow";

export function App() {
  const [query, setQuery] = useState("");
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [tab, setTab] = useState<Tab>("steps");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/recipes?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("recipes fetch failed")))
      .then((payload: { recipes: RecipeSummary[] }) => {
        setRecipes(payload.recipes);
        setError(null);
        setSelectedId((current) => current ?? payload.recipes[0]?.id ?? null);
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
    <main className="app-shell">
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
                setSelectedId(recipe.id);
                setTab("steps");
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
            </nav>
            {tab === "steps" ? <StepsView steps={detail.recipe.steps} /> : null}
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

function StepsView({ steps }: { steps: RecipeStep[] }) {
  return (
    <ol className="steps-view">
      {steps.map((step) => (
        <li key={step.id}>
          <div className="step-number">{step.order}</div>
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

