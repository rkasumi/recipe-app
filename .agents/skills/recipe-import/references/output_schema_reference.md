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
- 監査実行方法（既存 `subagent` fieldには通常 `used: false` と主モデルによる監査を記録）

後段の CLI batch と app は schema 済み recipe JSON を読む。raw source text を batch/app 側で再解釈してはいけない。

