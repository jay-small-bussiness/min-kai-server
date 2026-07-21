# Server Codex作業ログ 2026-07-21 14:08

担当: min-kai_server_codex  
対象: `INT-SRV-P0-001 新端末でのSolo購入復元を可能にする`

## 1. 参照した指示・設計

- `C:\Users\jaysm\min-kai\docs\integration-issues\instructions\server-instructions.md`
- `docs/codex-logs/server/propose_20260714/solo-multi-device-server-proposal.md`

Ver1.0では、同じ有効なGoogle Play Solo購入を異なるClient生成UUIDの複数端末で
利用可能にする。端末ごとの個人データはClientのSQLiteに残し、Serverでは同期しない。

## 2. 変更ファイル

- `server.js`
- `docs/codex-logs/server/codex_log_server_20260721_1408.md`

Client、Google、Site、Family関連コードは変更していない。

## 3. 実装内容

### Google Play検証をAccount作成より先に実行

購入同期の先頭にあった `findOrCreateAccountByUserId(userId)` を削除した。
packageに紐づく購入、商品、base plan、subscription state、有効期限をGoogle Play
Developer APIで検証し、有効なSolo購入であることを確認してからDBを変更する。

期限切れ、不正商品、不正base plan、不正tokenではAccount関連付けを変更しない。

### 購入資格の正本をbilling_purchases.account_idへ統一

DBトランザクション内で `purchase_token_hash` を `FOR UPDATE` 付きで取得する。
既存購入がある場合、その `billing_purchases.account_id` を対象の有料Accountとする。

`billing_purchases.user_id` は初回検証端末の記録として維持し、複数端末資格の
判定には使用しない。

### 新端末user_idの関連付け

- 未登録の `user_id` は既存有料Accountの `account_users` へ追加する。
- 既存Free Accountを持つ `user_id` は、`account_users.account_id` を有料Accountへ付け替える。
- 孤立したFree Accountは削除しない。
- 同じAccountへ関連済みの場合は冪等な正常再同期として扱う。
- 別の有効なSolo Accountへ所属済みの場合だけ409を返す。

旧エラー `purchase token is already linked to another user` は削除した。

### 同時同期対策

ロック順を次に統一した。

```text
billing_purchases.purchase_token_hash
→ account_users.user_id
→ 対象accounts.id
```

`purchase_token_hash` と `account_users.user_id` の既存一意制約を維持する。
`ER_DUP_ENTRY`、`ER_LOCK_DEADLOCK`、`ER_LOCK_WAIT_TIMEOUT` は最大3回まで
トランザクション全体を短時間再試行する。

### acknowledge処理の購入単位化

acknowledge結果のDB更新条件から `billing_purchases.user_id` を外し、
`purchase_token_hash` だけで対象購入を更新するよう変更した。

これにより、新端末の異なる `user_id` から再同期しても、初回端末のUUIDに依存せず
承認状態を修復できる。既存のPENDING時acknowledge、短時間再試行、期限更新は維持した。

### APIレスポンス・安全な運用ログ

購入同期APIへ次を追加した。

```text
accountLinkStatus
linkedDeviceCount
```

`accountLinkStatus` の値:

```text
existing_link
linked_existing_purchase
created_new_purchase
```

ClientはSolo判定にこの値を使用せず、従来どおりServerの `plan` を正とする。

Google Play照会とacknowledgeの通信エラーは一般化し、URLやGoogleレスポンス本文を
例外へ含めないようにした。ログは `tokenLength` と `tokenLast4` に限定する。

## 4. DB・トランザクション設計の要約

新規テーブルとスキーマ変更はない。既存構造を使用する。

```text
billing_purchases 1件
  └ account_id → accounts 1件
                    ├ account_users → 旧端末user_id
                    ├ account_users → 新端末user_id
                    └ account_users → 追加端末user_id
```

同じ購入資格から有料Accountを複数作らず、全関連端末が同じ `account_uuid`、
plan、status、expires_atを参照する。

## 5. 実行したローカルテスト

### 構文・差分

```text
node --check server.js
結果: 成功

git diff --check -- server.js
結果: 成功（改行コード警告のみ）
```

### 静的フロー検証

PowerShellによるソース検証で次を確認した。

- `getGooglePlaySubscription(purchaseToken)` がDB永続化より前にある。
- 購入同期関数内に事前の `findOrCreateAccountByUserId(userId)` がない。
- 旧 `purchase token is already linked to another user` が残っていない。
- `tokenHead` とpurchaseToken先頭部分のログがない。
- purchaseToken全文を直接console出力する処理がない。

結果: `Static billing flow assertions passed`

## 6. T-01〜T-08判定

| ID | ローカル判定 | Railway・実機判定 |
|---|---|---|
| T-01 同一端末再同期 | 冪等分岐 `existing_link` を実装済み | 未実施 |
| T-02 新UUIDの新端末復元 | `linked_existing_purchase` と既存Account関連付けを実装済み | 未実施 |
| T-03 Free Account作成済み端末 | `account_users.account_id` 付け替えを実装済み | 未実施 |
| T-04 不正・期限切れ購入 | Google検証後かつ有効SoloのみDB処理することを確認 | 未実施 |
| T-05 有料Account競合 | 別の有効Solo Accountだけ409にする分岐を実装済み | 未実施 |
| T-06 2端末同時同期 | 一意制約、FOR UPDATE、最大3回再試行を実装済み | 未実施 |
| T-07 期限切れ全端末Free | 同じAccountを参照する設計を確認 | 未実施 |
| T-08 ログ安全性 | 静的検索で問題なし | Railwayログ未確認 |

## 7. Railway反映

未反映。GitHubへのcommit・pushとRailwayデプロイ後に確認する。

## 8. Client担当へ依頼する実機確認

1. 旧端末で有効なSolo購入を作る。
2. 新端末または再インストール環境で別の `user_id` を生成する。
3. 新端末で先にplan APIを呼び、Free Accountが作成された状態も用意する。
4. 同じGoogle Playアカウントの既存購入を新端末から同期する。
5. 同期APIが2xx、`accountLinkStatus = linked_existing_purchase` を返すことを確認する。
6. 旧端末と新端末のplan APIが両方Soloを返すことを確認する。
7. 両端末の `account.accountUuid` が同じであることを確認する。
8. 各端末のローカルカテゴリー、商品、買い物リストが混在しないことを確認する。

実機確認時に記録する値:

```text
旧端末user_id: 未確認
新端末user_id: 未確認
共通account_uuid: 未確認
```

purchaseToken全文や先頭部分は記録しない。

## 9. 未確認事項・残存リスク

- 実際のRailway MySQLでの2端末同時同期は未確認。
- Google Playの同一購入を新端末Billingから取得する実機フローは未確認。
- 永続的なバックグラウンド再試行とRTDNは今回の対象外。
- 端末数上限はVer1.0では設けていない。
- API利用者認証は今回の指示範囲外であり、purchaseTokenのGoogle検証を資格確認に使用する。
- 孤立したFree Accountは残るが、利用資格判定には使用されない。
