---
name: recipe-import
description: メモ・抜粋・文字起こしからrecipe-appのschemaに合うレシピJSONと取込監査を作る。Web取得、アプリ実装、本番importには使わない。
---

# Recipe import

入力はsource note・抜粋・文字起こしと、判明している出典・分量・人数・調理条件。出力は `schemas/recipe.schema.json` に合うJSONと `schemas/import-audit.schema.json` に合う別の監査report。schemaの正本とfieldの意味は [出力契約](references/output_schema_reference.md)。

- 材料・手順・出典には [抽出規約](references/extraction_rules.md)、flowには [生成規約](references/flow_generation_rules.md) を適用する。
- 主モデルが [原文照合](references/source_fidelity_audit_rules.md) を行い、schemaだけでなく材料・手順・flow参照・欠落も検査する。不明点は `needs_review` / `review_reasons` に残す。
- 既存audit schemaの `subagent` は通常 `used: false`、`reason` は主モデルによる監査と記録する。別agentの不使用は不備ではない。
- sourceの自動取得、記事・動画・本の全文保存、本番import・SQLite生成・deployはこのSkillの範囲外。raw textをapp runtimeへ渡して再解釈させない。
