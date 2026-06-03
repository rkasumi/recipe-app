# Output Schema Reference

schema の正本:

- `schemas/recipe.schema.json`
- `schemas/import-audit.schema.json`

recipe JSON の最低限の概念:

- `id`
- `title`
- `servings`
- `source_refs`
- `ingredients`
- `steps`
- `flow`
- `audit`

audit report の最低限の概念:

- schema validation result
- source fidelity audit
- ingredient/step audit
- flow audit
- `needs_review`
- `review_reasons`
- subagent 使用有無と、未使用時の代替監査理由

後段の CLI batch と app は schema 済み recipe JSON を読む。raw source text を batch/app 側で再解釈してはいけない。

