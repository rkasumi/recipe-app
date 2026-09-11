# recipe-app

- レシピJSONが正本。`recipes.sqlite`は再生成可能、`journal.sqlite`は再生成できない自分メモとして分離する。
- Web書込みは自分メモだけ。`ENABLE_WRITES=true`と認証済みreverse proxyが前提。
- `sync`は削除を伴う。全JSON・ID重複検証、transaction、dry-runを維持する。fixtureと `.tmp/recipe-app/` で確認する。
- recipe schema変更時は `.agents/skills/recipe-import/` の出力契約も更新する。取込SkillはJSON作成の依頼だけで使う。
- production Compose・URL・port・nginx・Access・backup・import手順はprivate ops。app repoにはgeneric `compose.example.yml`だけ。実レシピ・SQLite・import logはcommitしない。
- 開発端末にDockerはない。Dockerfile/image検証はGitHub Actionsで行う。
- 通常検証はpackage scripts、recipe変更は `pnpm recipe:validate`、私有情報混入は `pnpm check:secrets`。
