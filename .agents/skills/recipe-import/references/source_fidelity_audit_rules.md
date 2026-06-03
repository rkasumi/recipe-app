# Source Fidelity Audit Rules

schema validation は監査の一部でしかない。次の観点を audit report に残す。

- source にある材料が recipe JSON に入っているか。
- source にある数量、単位、火加減、時間が保持されているか。
- source にない情報を足していないか。
- source の曖昧さを `needs_review` と `review_reasons` に残しているか。
- 任意材料、代替可能材料、好みで調整する分量が明示されているか。
- 手順順序が source と矛盾していないか。
- flow が手順と材料を正しく参照しているか。
- subagent を使えない場合、親 Codex が同じ観点で代替監査した理由を `subagent.reason` に書く。

