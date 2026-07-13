# recipe-app

Self-hosted recipe management app. Recipe JSON files are the source of truth, the CLI batch validates schema/audit data and generates SQLite, and the web app reads from SQLite/API. The first version is read-only in the browser and does not provide web editing.

## Quickstart

```bash
pnpm install
pnpm run recipe:validate
pnpm run recipe:dry-run
pnpm run recipe:import:sample
pnpm dev:api
pnpm dev
```

sample import 後の local SQLite は `.tmp/recipe-app/recipes.sqlite` にあります。

This repository includes only small hand-written fixtures. Keep real recipe data, generated SQLite, import logs, private URLs, credentials, and production paths outside Git.

## Data Contract

- recipe JSON schema: `schemas/recipe.schema.json`
- Skill audit report schema: `schemas/import-audit.schema.json`
- repo-local Skill: `.agents/skills/recipe-import/SKILL.md`
- sample source note: `fixtures/source-notes/oyakodon-note.md`
- sample recipe JSON: `fixtures/recipes/oyakodon.json`
- sample audit report: `fixtures/audits/oyakodon.audit.json`

`recipe-import` Skill は raw source を解釈して recipe JSON と audit report を作ります。CLI batch と app runtime は schema 済み JSON を読み、raw source text を再解釈しません。

## CLI Batch

```bash
pnpm run recipe:validate
pnpm run recipe:dry-run
pnpm run recipe:import:sample
pnpm run recipe:import-all:dry-run
node dist/cli/index.js status --data-dir .tmp/recipe-app
node dist/cli/index.js sync --recipes-dir fixtures/recipes --data-dir .tmp/recipe-app --dry-run
```

`sync` は全 JSON の schema/audit と recipe ID の重複を先に検査し、成功した場合だけ SQLite の
レシピ行を transaction 内で全置換します。`--dry-run` で削除予定を確認してから実行してください。
SQLite の `imported_at` / API の `importedAt` は初回作成日時ではなく、最終成功取込日時です。

production import は private ops runbook 側で管理します。この repository では local data dir に対する validate / dry-run / import / sync を扱います。

## App

- `GET /health`, `GET /healthz`
- `GET /api/recipes?q=...`
- `GET /api/recipes/:id`
- `GET /api/recipes/:id/notes`
- `PUT /api/recipes/:id/notes` (`ENABLE_WRITES=true` の場合のみ)

画面はレシピ一覧、通常手順ビュー、材料ビュー、フローチャートビュー、audit warnings、source refs、AND検索、
買い物リスト、調理モード、自分メモを持ちます。自分メモはレシピJSONとは分離した `journal.sqlite` に保存します。
書き込みは既定で無効です。Cloudflare Accessなどの認証済みreverse proxy配下でのみ `ENABLE_WRITES=true` にしてください。
`journal.sqlite` は再生成物ではないため、書き込みを有効にする運用ではバックアップ対象です。

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm run check:secrets
docker compose -f compose.example.yml config
```

Docker daemon や network が必要な check は、実行環境に応じて実施します。

## Self-hosting example

This repo keeps app code, local development, tests, build, and a generic compose example. Production deploy, public URL, host port, volume path, nginx, backup, and import runbook are managed in a private ops repo.

```bash
docker compose -f compose.example.yml up -d --build
docker compose -f compose.example.yml run --rm recipe-app node dist/cli/index.js status --data-dir /data
```

Do not commit real recipe data, private URLs, credentials, or production paths.
