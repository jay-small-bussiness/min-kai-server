# Solo複数端末対応 Server変更案

作成日: 2026-07-14  
担当: min-kai_server_codex

## 1. 目的

同一Google Playアカウントで有効なSolo定期購入を所有している場合、端末ごとに
異なるClient生成UUIDの `user_id` を使用しても、複数端末でSoloを利用できるようにする。

個人カテゴリー、候補商品、買い物リスト、履歴などは各端末のローカルSQLite DBに置き、
Serverでは自動同期しない。Family共有データとSolo利用資格も分離する。

## 2. 現行実装

現在の主なテーブル関係は次のとおり。

```text
accounts
  1 ── N account_users
  1 ── N billing_purchases
```

`account_users.user_id` には一意制約があり、1つの `user_id` は同時に1つのAccountへ
所属する。一方、`account_users.account_id` は一意ではないため、1つのAccountへ複数の
`user_id` を関連付ける構造は既に存在する。

現行の購入同期処理は、最初に `findOrCreateAccountByUserId(userId)` を実行してから
Google Play購入を検証する。同じpurchaseTokenが別の `user_id` から届くと、
`billing_purchases.purchase_token_hash` の既存行を検出し、次の409を返す。

```text
purchase token is already linked to another user
```

この制限により、新端末で既存購入を復元できない。

## 3. 推奨する基本設計

Soloの複数端末対応では、同じ購入資格ごとに有料Accountを増やさない。
同じpurchaseTokenをGoogle Playで検証できた端末を、既存の有料Accountへ関連付ける。

```text
Google Play Solo購入
        │
        ▼
billing_purchases（購入資格1件）
        │ account_id
        ▼
accounts（論理Account 1件）
        │
        ├ account_users ─ 旧端末user_id
        ├ account_users ─ 新端末user_id
        └ account_users ─ 追加端末user_id
```

各端末の個人データはServerへ保存しないため、同じAccountに関連付けてもローカルデータは
混ざらない。`account_users` はSoloデータ同期ではなく、利用資格を参照するための関連付けとする。

## 4. 採用しない案

### 4.1 409だけを削除して端末ごとにSolo Accountを作る

採用しない。同じ購入資格から有料Accountを無制限に作れるため、期限同期、端末管理、
不正利用検知が難しくなる。

### 4.2 purchaseTokenをuser_idとして扱う

採用しない。purchaseTokenは購入検証用の秘密値であり、Client識別子や恒久IDではない。

### 4.3 新端末へ旧端末のuser_idを返す

採用しない。端末ごとのUUIDとローカルデータ環境を維持できず、Client方針と矛盾する。

## 5. 購入同期処理の変更

### 5.1 処理順序

`syncGooglePlaySoloPurchase()` を次の順序へ変更する。

```text
1. リクエスト形式を検証
2. purchases.subscriptionsv2.getでGoogle Play購入を検証
3. 商品、base plan、状態、有効期限、承認状態を確認
4. purchaseTokenをSHA-256でハッシュ化
5. DBトランザクション開始
6. purchase_token_hashの既存購入をFOR UPDATEで検索
7. 既存購入なら、そのbilling_purchases.account_idを対象Accountとする
8. 新規購入なら、現在のuser_idのAccountを対象Accountとする
9. user_idを対象Accountへ関連付ける
10. 対象Accountとbilling_purchasesを最新状態へ更新
11. DBコミット
12. PENDINGの場合だけGoogle Playへacknowledge
13. 承認結果をDBへ保存
14. 対象Accountの実効planをClientへ返す
```

Google Play検証前に新しいAccountを作らない。無効なpurchaseTokenを送るだけで不要な
Accountを増やさないためである。

### 5.2 既存purchaseTokenの場合

Google Play検証が成功し、`purchase_token_hash` が既に存在する場合は、既存行の
`account_id` を購入資格の所属先として採用する。

```text
existingPurchase.account_id = paidAccountId
```

新しい `user_id` が未登録なら、`account_users` に次を追加する。

```sql
INSERT INTO account_users (account_id, user_id, linked_at, unlinked_at)
VALUES (:paidAccountId, :newUserId, CURRENT_TIMESTAMP, NULL);
```

### 5.3 新端末が既にFree Accountを持つ場合

新端末は購入同期前に `/api/account/plan` を呼び、既にFree Accountを作成している可能性がある。
この場合は、新しい有料Accountを作らず、既存の `account_users` 行を有料Accountへ移す。

```sql
UPDATE account_users
   SET account_id = :paidAccountId,
       linked_at = CURRENT_TIMESTAMP,
       unlinked_at = NULL
 WHERE user_id = :newUserId;
```

移動元のFree Accountは即時削除しない。次をすべて満たす孤立Accountだけを、将来の
クリーンアップ対象にできる。

- 有効な `account_users` がない
- `billing_purchases` がない
- Familyメンバーシップや共有データ所有がない
- 手動付与などの有効な資格がない

Ver1.0では孤立Accountを残しても利用資格には影響しないため、削除処理は先送り可能。

### 5.4 既に別の有料Accountへ所属する場合

新しい `user_id` が、別の有効なSolo購入を持つAccountへ既に所属している場合は、
自動マージしない。409を返し、運用上の確認対象とする。

```text
409 user is already linked to another active paid account
```

期限切れFree Accountから有効なSolo Accountへの移動は許可する。

### 5.5 billing_purchases.user_idの扱い

現行の `billing_purchases.user_id` は、最初に購入同期した `user_id` として保持する。
複数端末関連付けの正本には使用しない。正本は `billing_purchases.account_id` と
`account_users` の組み合わせとする。

将来、列名を `initial_user_id` または `first_verified_user_id` へ変更する案はあるが、
Ver1.0では破壊的変更を避け、意味を仕様で固定する。

## 6. DB変更案

### 6.1 Ver1.0最小変更

必須の新テーブルはない。既存の次の構造を利用できる。

- `accounts.id`
- `account_users.account_id`
- `account_users.user_id`
- `billing_purchases.account_id`
- `billing_purchases.purchase_token_hash`

必要な変更は、購入同期トランザクションと関連付けルールが中心となる。

### 6.2 推奨する運用列

端末数の把握と無効化に備え、`account_users` へ次を追加する案を推奨する。

```sql
ALTER TABLE account_users
  ADD COLUMN link_source varchar(30) DEFAULT NULL,
  ADD COLUMN last_seen_at datetime DEFAULT NULL;
```

値の例:

```text
link_source = trial_created
link_source = google_play_purchase
link_source = google_play_restore
```

既存の `unlinked_at` を端末利用資格の無効化に利用する。

### 6.3 関連付け監査

Account間の付け替え履歴が必要になった場合は、後続タスクとして次の監査テーブルを追加する。

```text
account_user_link_events
  id
  user_id
  from_account_id
  to_account_id
  reason
  created_at
```

Ver1.0の必須条件ではないが、サポート対応や不正利用調査には有効である。

## 7. トランザクションと競合対策

同じpurchaseTokenが複数端末から同時に送信される可能性があるため、次を守る。

- Google Play API呼び出しはDBトランザクション開始前に行う。
- `billing_purchases` は `purchase_token_hash` の一意制約を維持する。
- 既存購入の取得には `SELECT ... FOR UPDATE` を使用する。
- `account_users.user_id` の一意制約を維持する。
- 対象 `account_users` 行もトランザクション内でロックする。
- Duplicate key発生時は再取得し、同じAccountへの関連付けなら正常な冪等再送として扱う。
- purchaseToken全文はDB、ログ、例外、APIレスポンスへ保存しない。

同じ端末からの再同期、複数端末からの同時同期、acknowledge済み購入の再同期をすべて正常系として扱う。

## 8. Google Play検証条件

新しい端末を既存Accountへ追加する前に、必ずServerからGoogle Play Developer APIへ問い合わせる。

必須条件:

- package nameが `com.business.small.jay.shoppinglist002`
- `productId = min_kai_solo_monthly`
- `basePlanId = monthly-auto`
- `subscriptionState` が利用可能な状態
- `expiryTime` が未来
- `acknowledgementState` を取得できる

利用可能状態は現行どおり、少なくとも次を含む。

```text
SUBSCRIPTION_STATE_ACTIVE
SUBSCRIPTION_STATE_IN_GRACE_PERIOD
```

期限切れ、取消済みで権利期間も終了、失効、不正な商品、不正なbase planでは新端末を追加しない。

## 9. linkedPurchaseToken

再購入、アップグレード、ダウングレードなどで新しいpurchaseTokenが発行された場合、
Google Playレスポンスの `linkedPurchaseToken` を利用して旧購入との連続性を確認できる。

Ver1.0の同一プラン・複数端末復元では、同じ有効なpurchaseTokenの再取得を主経路とする。
`linkedPurchaseToken` によるAccount引継ぎは、再購入やプラン変更を実装するときの後続タスクとする。

## 10. 全端末への期限反映

複数端末が同じ `accounts.id` を参照するため、`accounts.expires_at` を更新すれば、
すべての関連端末の `/api/account/plan` が同じ実効期限を使用する。

```text
有効期限内:
  関連する全user_id → Solo

有効期限後:
  関連する全user_id → Free
```

短期対応では、いずれかの端末が起動・前面復帰してpurchaseTokenを再同期すると、
共有Accountの `expires_at` が更新される。

端末が1台も起動しない場合の解約、払い戻し、猶予期間、アカウント一時停止、期限切れの
即時反映にはRTDNが必要である。RTDNは後続タスクとするが、`billing_purchases.account_id`
から対象Accountを特定できる構造を維持する。

## 11. Familyとの分離

Solo購入検証は `accounts.plan_type` と `billing_purchases` だけを更新する。
Family参加資格やFamily共有データは更新しない。

将来のFamily実装では、次のような別構造を使用する。

```text
family_groups
family_memberships（family_id, account_id, role, status）
family_categories
family_products
family_shopping_lists
family_activity_log
```

Soloの複数端末関連付けだけを理由に、Familyへの招待、参加、脱退を行わない。

## 12. セキュリティと不正利用対策

Google Playは通常の購入検証レスポンスで購入者のメールアドレスをServerへ返さない。
そのため、同じGoogle Playアカウントであることの実務上の証明は、その端末の
Google Play Billingが既存購入として返した有効なpurchaseTokenをServerが再検証できることになる。

必要な対策:

- purchaseToken全文をログ、Markdown、APIレスポンスへ出さない。
- Clientから渡された商品状態を信用せず、Google Play APIを正とする。
- Accountへ関連付ける前に毎回Google Playで有効性を確認する。
- Account単位で関連端末数を取得できるようにする。
- 新規端末関連付けを安全な運用ログへ記録する。
- 短時間に多数の新しい `user_id` が追加された場合に検知できる余地を残す。
- `unlinked_at` による端末無効化を可能にする。
- 端末数の上限はプロダクト仕様を決めてから設定し、コードへ固定値を埋め込まない。

`obfuscatedAccountId` は購入とmin-Kai Accountの紐付け強化に利用できるが、端末ごとに
異なる `user_id` をそのまま設定すると、複数端末で同じ値にならない。導入する場合は、
Serverが発行する安定したAccount識別子をClientへ渡す設計とセットで検討する。

## 13. APIレスポンス案

既存レスポンスとの互換性を維持し、任意で次を追加する。

```json
{
  "status": "ok",
  "accountLinkStatus": "linked_existing_purchase",
  "account": {
    "accountUuid": "...",
    "planType": "solo",
    "status": "active",
    "expiresAt": "..."
  },
  "plan": {
    "plan": "Solo"
  }
}
```

`accountLinkStatus` 候補:

```text
existing_link
linked_existing_purchase
created_new_purchase
```

Clientはこの値をSolo判定に使用せず、従来どおり `plan` を正とする。

## 14. エラー方針

```text
400  リクエスト形式、store、product ID、base plan IDが不正
401  将来のClient認証に失敗
409  user_idが別の有効な有料Accountへ既に所属し、自動マージできない
409  有効な関連端末数の上限を将来超過した場合
409  Google Play購入がSolo商品と一致しない
5xx  Google PlayまたはDBの一時障害
```

同じ有効なpurchaseTokenを新しい `user_id` が提示したことだけを理由に409を返さない。

## 15. 実装順

### Phase 1: 現行構造を使った複数端末対応

1. 購入同期をGoogle Play検証先行へ変更する。
2. `purchase_token_hash` から既存 `billing_purchases.account_id` を取得する。
3. 新しい `user_id` を既存Accountへ関連付ける処理を追加する。
4. 既存Free Accountから有料Accountへの安全な付け替えを追加する。
5. 別の有効な有料Account同士は自動マージしない。
6. acknowledgeと承認状態保存の現行処理を維持する。
7. APIレスポンスへ `accountLinkStatus` を追加する。

### Phase 2: 運用性向上

1. `account_users.link_source` と `last_seen_at` を追加する。
2. 関連端末数と最終利用時刻を確認する運用SQLを用意する。
3. 端末無効化フローを設計する。
4. 不自然な大量関連付けを検知する。
5. 必要に応じて関連付け監査テーブルを追加する。

### Phase 3: 継続同期

1. RTDNを導入する。
2. 更新、解約、期限切れ、払い戻し、猶予期間、アカウント一時停止をAccountへ反映する。
3. `linkedPurchaseToken` を使った再購入・プラン変更時のAccount引継ぎを実装する。

## 16. テスト計画

### T-01 同一端末の再同期

- 同じ `user_id` とpurchaseTokenを再送する。
- 2xx、Solo、`existing_link` になる。
- ACKNOWLEDGED済み購入を再承認しない。

### T-02 新端末での復元

- 新端末で新しい `user_id` を生成する。
- 同じGoogle Playアカウントから既存購入を取得する。
- Serverへ同期し2xxになる。
- `linked_existing_purchase` になる。
- 旧端末と新端末の両方でSoloになる。
- 2端末の `account_uuid` が同じになる。

### T-03 新端末に既存Free Accountがある

- 新端末で先に `/api/account/plan` を呼び、Free Accountを作る。
- その後、既存Solo購入を同期する。
- `account_users.account_id` が有料Accountへ移る。
- 孤立したFree AccountがSoloへ更新されない。

### T-04 不正な購入

- dummy token、不正商品、不正base plan、期限切れ購入を送る。
- 新しいAccount関連付けを作らない。
- Soloを付与しない。

### T-05 別の有料Accountとの競合

- 別購入で有効なSolo Accountへ所属する `user_id` から同期する。
- 自動マージせず409になる。
- 既存の両購入とAccountを変更しない。

### T-06 同時同期

- 2端末から同じpurchaseTokenをほぼ同時に同期する。
- 一意制約違反で500にならない。
- 1つの `billing_purchases` と1つの有料Accountだけが残る。
- 両端末が同じAccountへ関連付く。

### T-07 期限切れ

- テスト購入の最大更新回数終了後まで待つ。
- 旧端末と新端末の `/api/account/plan` が両方Freeを返す。
- ローカルSQLiteデータは端末間で混ざらない。

### T-08 ログ安全性

- purchaseToken全文と先頭部分がRailwayログへ出ない。
- サービスアカウントJSON、秘密鍵、アクセストークンが出ない。
- tokenLengthとtokenLast4だけが必要に応じて出る。

## 17. 完了条件

- 同じ有効なGoogle Play Solo購入を、異なる `user_id` の複数端末で利用できる。
- 同じ購入資格から有料Accountを複数作らない。
- 旧端末と新端末は同じ `account_uuid` を参照する。
- 各端末の個人用ローカルデータは同期されない。
- 同一端末の再同期と複数端末の同時同期が冪等に動作する。
- 期限切れ後、関連端末すべての実効planがFreeになる。
- 不正な購入では端末関連付けもSolo付与も行わない。
- Family参加資格とSolo購入資格を混同しない。
- 秘密情報をログ、DBの平文、APIレスポンス、Markdownへ残さない。

## 18. 実装前に決める事項

1. 1つのSolo購入に関連付ける端末数へ上限を設けるか。
2. 既存Free AccountからSolo Accountへ移動した履歴をVer1.0から保存するか。
3. 既に別の有効なSolo Accountへ所属するuser_idの扱いを常に409とするか。
4. `accountLinkStatus` をClient UIまたは運用ログで使用するか。
5. `account_users.link_source` と `last_seen_at` をPhase 1へ含めるか。

上記のうち端末数上限以外は、推奨初期値を次のように置ける。

```text
有料Account同士の自動マージ: しない
accountLinkStatus: APIへ追加するがSolo判定には使用しない
link_source / last_seen_at: Phase 2
孤立Free Account削除: 先送り
RTDN: Phase 3
```
