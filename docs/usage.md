# recipe-app usage

## recipe-import Skill 用 prompt

```text
$recipe-import

次の source note から recipe-app 用 recipe JSON と import audit report を作ってください。
schema 正本は schemas/recipe.schema.json と schemas/import-audit.schema.json です。
schema validation だけで終えず、source fidelity、ingredient/step 対応、flow 参照、missing information を監査してください。
production import は実行しないでください。

サブエージェントの利用を明示的に許可します。監視にはサブエージェントを必須としてください。

source:
<ここにメモや抜粋を貼る>
```

## JSON 作成後の確認

```bash
pnpm -s build:server
node dist/cli/index.js validate path/to/recipe.json
node dist/cli/index.js dry-run path/to/recipe.json --data-dir .tmp/recipe-app
```

`needs_review=true` の recipe は、review reasons と missing information を確認してから import します。

## local import

```bash
pnpm -s build:server
node dist/cli/index.js import path/to/recipe.json --data-dir .tmp/recipe-app
node dist/cli/index.js import-all --recipes-dir fixtures/recipes --data-dir .tmp/recipe-app
node dist/cli/index.js status --data-dir .tmp/recipe-app
```

SQLite は生成物です。JSON 正本を変更したら、同じ data dir に対して import を再実行します。

## local app

```bash
pnpm dev:api
pnpm dev
```

API は既定で `127.0.0.1:8080`、Vite は `127.0.0.1:5173` です。

## self-hosting example

```bash
pnpm -s build
docker compose -f compose.example.yml config
docker compose -f compose.example.yml up -d --build
docker compose -f compose.example.yml run --rm recipe-app node dist/cli/index.js status --data-dir /data
```

production deploy、public URL、host port、volume path、nginx、backup、production import runbook は private ops repo 側で管理します。この repo の docs には private deployment surface を置きません。

## 禁止事項

- production import 手順を app repo に戻さない。
- secret 実値、利用者メールアドレス、private URL、production path を repo に置かない。
- app runtime に raw source text の曖昧な解釈を実装しない。
