---
name: recipe-import
description: "Use when converting YouTube descriptions, YouTube transcripts, MacWhisper transcripts, book/article excerpts, or manual cooking notes into recipe-app JSON. Input is source notes or excerpts plus any known citation metadata. Output is schema-valid recipe JSON and a separate import audit report for recipe-app. This skill creates structured data for the app and CLI batch; it does not fetch sources, scrape pages, store full articles, edit the web app, or import production data."
---

# Recipe Import

## 役割

この Skill は、手入力メモ、YouTube概要欄、YouTube文字起こし、MacWhisper文字起こし、本や記事の抜粋から、recipe-app が読む recipe JSON を作る。raw text から直接 SQLite に import したり、Web編集を代替したりしない。

## 入力

- source note または抜粋本文。
- 出典種別、タイトル、URL の有無、メモの保存先。
- 既知の分量、人数、調理条件、曖昧な箇所。

## 出力

- `schemas/recipe.schema.json` に合う recipe JSON。
- `schemas/import-audit.schema.json` に合う audit report。
- `needs_review` と `review_reasons`。迷う点を空欄や推測で埋めない。

## 手順

1. `references/extraction_rules.md` を読む。
2. `references/flow_generation_rules.md` を読む。
3. `references/source_fidelity_audit_rules.md` を読む。
4. `references/output_schema_reference.md` を読み、schema正本の場所を確認する。
5. recipe JSON を作る。材料、手順、出典、flow、audit をすべて含める。
6. schema validation だけで終えず、source fidelity、ingredient/step対応、flow参照、missing information を監査する。
7. subagent が使える場合は監査に使う。使えない場合は audit report に理由を書き、親 Codex が同じ観点で監査する。

## 対象外

- Web記事、動画、本の自動取得やスクレイピング。
- 動画、記事、本の全文保存。
- production data への import。
- SQLite生成、Docker deploy、Cloudflare/DNS変更。
- recipe JSON なしで app runtime に raw text を解釈させること。

