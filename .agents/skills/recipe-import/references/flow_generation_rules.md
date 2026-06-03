# Flow Generation Rules

- `flow.nodes` は調理の見通しを作るための表示用構造であり、手順本文の代替ではない。
- node kind は `ingredient_group`, `action`, `note`, `wait`, `combine`, `finish` のいずれかにする。
- `lane` と `rank` で初期配置を決める。スマホでは横に長くなりすぎないよう、rank を詰めすぎない。
- 調理工程に対応する node は `step_id` を設定し、存在する `steps[].id` を参照する。
- node の `ingredients` は存在する ingredient id のみを参照する。
- edge は存在する node id のみを参照する。材料ブロックから工程、工程から工程、工程から完成へ流す。
- 迷う並列工程や合流は `combine` または `note` node にし、`audit.warnings` に判断理由を残す。

