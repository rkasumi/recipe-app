# AGENTS.md

## Repo Notes

- レシピJSONを正本とし、CLIで検証・監査して検索表示用の `recipes.sqlite` を生成するセルフホスト型アプリ。
- Node 24 / pnpm 10 / TypeScript strict / React 19 + Vite / Express 5 / better-sqlite3 を使う。
- `recipes.sqlite` は再生成可能な生成物。自分メモの `journal.sqlite` は再生成できない永続データとして分離する。
- レシピ本文はWebから変更しない。書き込みAPIは自分メモだけに限定し、`ENABLE_WRITES=true` と認証済みreverse proxyを前提にする。
- `sync` は削除を伴う。全JSONの検証とrecipe ID重複確認を先に行い、transactionと `--dry-run` の安全性を維持する。
- recipe schemaを変える場合は、型・fixture・validation test・`.agents/skills/recipe-import/` の契約を同時に確認する。
- production compose、公開URL、host port、nginx、Cloudflare Access、backup、import runbook、service registryはprivate `ops` repoを正本とする。このrepoには汎用 `compose.example.yml` だけを置く。
- 実レシピ、生成SQLite、import log、credentials、private URL、本番pathをGitに入れない。
- 開発端末にDockerはない。Dockerfileとproduction imageの検証はGitHub Actionsで行い、ローカル完了条件にDockerを含めない。

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm run recipe:validate
pnpm run check:secrets
```

CLIや同期処理を変えた場合は、実データではなくfixtureと `.tmp/recipe-app/` を使って `dry-run` / `sync --dry-run` も確認する。
