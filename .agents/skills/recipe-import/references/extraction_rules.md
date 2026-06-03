# Extraction Rules

- 原文にある材料、数量、単位、火加減、時間、順序、任意材料を落とさない。
- 原文にない分量、人数、代替材料、手順を推測して追加しない。
- 不明な分量は `quantity` を空で補完せず、`audit.missing_information` と `needs_review` に残す。
- 任意材料は `note` に「あれば」「任意」などの根拠を残す。
- source は `source_refs` に分離し、各 ingredient/step には可能な範囲で `source_ref_id` を付ける。
- 動画や記事や本の全文保存を前提にしない。保存するのは、構造化に必要な抜粋、出典メモ、監査結果に限る。

