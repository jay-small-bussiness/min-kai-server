# Report-2026-04-25-UserID_UUID対応

## 1. 背景
UserID を `int` 前提で扱っていた箇所を、client と server で UUID 文字列に統一するための対応を実施した。対象は、音声検索の利用回数管理で使用している `user_id` と、その保存先である `voice_search_usage` テーブル、および関連 API の受け渡しである。

## 2. 実施内容
- client 側対応（概要）
  client アプリ側で UserID を UUID 文字列として生成し、server DB へ送信されることを確認した。
- server 側対応（server.js / DB変更）
  `server.js` の `user_id` 取り扱いを UUID 文字列前提に変更した。`/api/account/plan` と `/api/voice-search/usage` で受け取る `user_id` を UUID 形式の文字列として扱うようにした。
- テーブル変更内容（型変更など）
  `voice_search_usage.user_id` を `VARCHAR(36)` として扱うように変更した。`ensureVoiceSearchUsageSchema()` でも `VARCHAR(36)` に補正する処理を追加した。

## 3. 実行した作業
- server リポジトリの `server.js` を確認し、`user_id` の受け取り箇所と `voice_search_usage` テーブル定義を特定した。
- `server.js` に UUID 文字列用の正規化処理を追加した。
- `/api/account/plan` で `user_id` / `X-User-ID` を UUID 文字列として扱うように変更した。
- `/api/voice-search/usage` で `req.body.user_id` を UUID 文字列として扱うように変更した。
- `voice_search_usage.user_id` の型を `VARCHAR(36)` に変更し、既存テーブルに対する schema 補正処理を追加した。
- client アプリ側から UserID を文字列生成し、server DB に保存されていることを確認した。
- Railway と DBeaver を使用して確認を行った。

## 4. 確認結果
- client アプリ側から送信した UserID 文字列が、server DB へ到達していることを確認した。
- DBeaver 上で `voice_search_usage` テーブルに保存された `user_id` を確認し、UUID 文字列として保存されていることを確認した。
- UserID の文字列生成と DB 保存については、client から server DB まで疎通できていることを確認した。
- Railway 上の `GET /api/account/plan` を実リクエストで確認し、`user_id` なしの場合は `Free` が返ることを確認した。
- Railway 上の `GET /api/account/plan?user_id=invalid` を実行し、不正な `user_id` の場合は `400` が返ることを確認した。
- Railway 上の `GET /api/account/plan?user_id=40159c90-5aaa-4de3-bfd7-83c52f23f0cf` を実行し、正常な UUID に対して `plan: Free` が返ること、および `voiceSearch.remainingToday: 2` が返ることを確認した。
- DBeaver で対象 UserID に紐づく `accounts.plan_type` を `Solo` に変更したところ、テスト環境のボイス検索画面で `Solo` として反映されることを確認した。
- `/api/account/plan` が `user_id` 起点で `plan_type` を返し、その結果がクライアント画面に反映されることを確認した。
- 実端末からの動作確認により、`Solo` と `Free` の切り替え結果がボイス検索画面へ反映されることを確認した。
- DBeaver で `Solo` と `Free` を書き換えながら確認し、実効プラン切り替えが端末表示に反映されることを確認した。
- `voice_search_usage` は `Free` のときだけ利用記録が増え、`Solo` のときは利用記録が増えないことを確認した。

## 4.1 確認用SQL

### account_users の重複確認
```sql
SELECT
  user_id,
  COUNT(*) AS cnt
FROM account_users
GROUP BY user_id
HAVING COUNT(*) > 1;
```

### 特定 UserID の紐づき確認
```sql
SELECT
  au.id,
  au.account_id,
  au.user_id,
  a.plan_type,
  a.status,
  a.expires_at
FROM account_users au
INNER JOIN accounts a ON a.id = au.account_id
WHERE au.user_id = '40159c90-5aaa-4de3-bfd7-83c52f23f0cf';
```

## 5. 影響範囲
- 影響を受ける API
  `GET /api/account/plan`
  `POST /api/voice-search/usage`
- 影響を受けるテーブル
  `accounts`
  `account_users`
  `voice_search_usage`
- 今後修正が必要な箇所（P0-2以降）
  P0-2 以降の対象は、この記録時点では未対応。

## 6. 次のアクション
- P0-2 の対象範囲を整理する。
- `user_id` を利用している client / server 間の残タスクを洗い出す。
- UUID 化後の API 受け渡しが全経路で揃っているかを継続確認する。

## 7. ステータス
- P1-6「server に Ver1.0 の `Account` / `account_users` / `voice_search_usage` を実装する」は、server 実装、実端末確認、DBeaver による `Solo` / `Free` 切り替え確認、`voice_search_usage` 記録条件確認まで完了した。
- P1-7「`/api/account/plan` の response 契約を client 実装と揃える」は、server response shape と client DTO / 使用箇所の差分調査、および `docs/spec/account-plan.md` への正式契約追記まで完了した。

## 8. P1-7 作業記録
- `server.js` の `/api/account/plan` response shape を確認し、top-level fields が `plan`、`features`、`restrictionNotice`、`screenHelp` であることを整理した。
- client 側の `AccountPlanResponseDto`、`AccountPlanApiService`、`AccountPlanRefreshService`、`AccountPlanCacheService`、`VoiceSearchViewModel`、`RestrictionNoticePopupPage` の参照内容を確認した。
- `plan` は `Free | Solo | Family` の non-null string として固定し、unknown plan は server が返さない前提で仕様化した。
- `features.sync` は non-null boolean、`Family` のときだけ `true`、Ver1.0 では実質未使用でも後方互換のため返し続ける方針として整理した。
- `features.voiceSearch` は server contract として non-null object とし、`trialActive`、`trialEndsAt`、`dailyLimit`、`remainingToday`、`restricted` の型、nullable、safe default を仕様へ明記した。
- `restrictionNotice` は server contract として non-null object とし、`title`、`body`、`campaignId`、`actions[]` の構造を仕様へ明記した。
- client Ver1.0 で実際に使用している `restrictionNotice` の項目が `title`、`body`、`actions[].type`、`actions[].label` であり、`campaignId` は現状未使用であることを整理した。
- `screenHelp` は non-null object map とし、Ver1.0 では empty object `{}` を safe default として許容する方針を仕様へ明記した。
- `docs/spec/account-plan.md` に `GET /api/account/plan` の response contract と、`Free` / `Solo` / `Family` の example response を追記した。
- P1-7 では server / client の実装修正は行わず、現状ほぼ一致している response shape を正式仕様として固定した。
