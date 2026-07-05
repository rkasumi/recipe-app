# recipe-app

- 目的: レシピJSONを正本としてSQLite化するCLIバッチと、それを読み取り専用で表示するReact Web/Express APIから成るセルフホスト型レシピ管理アプリ。
- スタック: Node / pnpm workspace(`pnpm@10.33.4`)、TypeScript、Vite(web)+ Express(server)+ better-sqlite3、Docker(`Dockerfile`, `compose.example.yml`)。
- 主要コマンド: install `pnpm install` / dev `pnpm dev`(vite)・`pnpm dev:api`(tsx watch server) / build `pnpm build` / start `pnpm start` / test `pnpm test` / typecheck `pnpm typecheck` / lint `pnpm lint`
- レシピCLI: `pnpm recipe:validate` / `pnpm recipe:dry-run` / `pnpm recipe:import:sample` / `pnpm recipe:import-all:dry-run` / secret検査 `pnpm run check:secrets`
- 注意: 本番deploy・公開URL・ホストポート・nginx・backup・import runbookはprivate ops repo管理(このrepoは`compose.example.yml`のみ)。実レシピデータ・生成SQLite(`.tmp/recipe-app/`)・credentials・本番パスはgit管理しない。
