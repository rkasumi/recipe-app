# 依存関係のセキュリティ運用

## 更新PRと脆弱性報告

Dependabotアラートと通常のバージョン更新PRを区別します。同じGHSAが複数のパッケージ・バージョンで検出された場合、報告では1件にまとめ、影響する全バージョンとアラート番号を併記します。

`.github/dependabot.yml` では、セキュリティ更新をproduction依存とdevelopment依存に分けてグループ化します。通常更新のminor/patchはReact・ReactDOM・型定義を先にまとめ、その他をproductionとdevelopmentに分けます。major更新は個別に検証します。GitHub Actionsのminor/patchとDocker更新は別に扱います。

グループ化はPR対応回数を減らすための設定で、アラートを無効化するものではありません。週次スケジュールとcooldownは通常更新の設定です。セキュリティ更新を週次対応まで一律に待たせません。自動マージは設定していません。

## 影響の分類

| 分類 | 対象例・確認事項 |
| --- | --- |
| 本番サーバーに影響する可能性 | Express、body-parser、better-sqlite3、Node、ベースイメージ。問題の処理へ公開リクエストから到達するか確認する |
| CLIの入力処理 | Ajv、ajv-formats、fast-uriなど。入力レシピJSON・URIの検証処理を確認する。ライブラリの存在だけで公開APIから到達可能と断定しない |
| 配信されるブラウザーコード | React、ReactDOM、React Flowなど。実際に配信されるコードと利用APIを確認する |
| 開発・CI環境の条件付き影響 | Vite、tsup、tsx、Biomeなど。開発サーバー公開、OS、外部入力、対象機能の利用条件を確認する |
| 未確認 | 依存経路、実行環境、成立条件が不明な場合。未確認と明記し、安全と断定しない |

Dockerfileはビルド後に `pnpm prune --prod` を実行し、本番ではExpressからビルド済み画面を配信します。Viteの開発サーバーは本番の起動コマンドに含まれません。`devDependencies` から成果物へ組み込まれるコードもあるため、GitHubのscopeだけで本番影響を判断しません。

報告には、確認日時・対象コミット、未解決アラート数とGHSA重複除外後の件数、対象バージョンと依存経路、上表の分類・成立条件・確認根拠・未確認事項、対応PRと検証結果、本番反映の確認状況を記載します。

認証済みGitHub CLIとローカルlockfileで読み取り専用の確認ができます。アラート出力や実データを公開先・追跡ファイルへ保存しません。

```sh
gh api --paginate --slurp repos/rkasumi/recipe-app/dependabot/alerts
pnpm audit
pnpm audit --prod
```

GitHubのfixed状態やローカル監査0件は、本番への反映やOS・ネイティブライブラリまでの安全性を保証しません。特にbetter-sqlite3は本番イメージ内のNode ABIとSQLiteでの動作をCIでも確認します。

## 検証と依存の削減

Biomeの明示的なルールで未使用変数、明示的any、危険なJS構文などを検査し、TypeScriptのstrictチェックでアプリとテストを型検査します。フォーマット・import順序の自動変更は行いません。BiomeはESLintの完全互換ではなく、動的なRegExp生成やtriple-slash参照など一部の診断には差があります。該当コードを変更するときはレビューでも確認します。

Node標準テストはAPI、自分メモの書込み禁止、レシピ同期の事前検証・重複ID拒否・transaction rollback、journalの保持をfixtureで検証します。実レシピ・本番由来DB・既存journalをテストに使用しません。

依存更新では `pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm build`・`pnpm recipe:validate`・`pnpm check:secrets` を実行します。必要に応じて、ビルド後の `node scripts/image-smoke.mjs fixtures/recipes` で一時DBを使ったCLI/APIの統合確認も行います。Dockerイメージの確認はGitHub Actionsで実施し、ローカルでの成功と区別します。

ESLintとVitestは使用しません。tsupはサーバー・CLIのビルドに、tsxは開発起動とTypeScriptテストに使用します。overridesは依存経路が消えたものだけ削除し、残るセキュリティ固定を維持します。

参照：[Dependabot設定](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)、[Biome移行](https://biomejs.dev/installation/migrate-from-other-tools/)、[Node 24テスト](https://nodejs.org/docs/latest-v24.x/api/test.html)
