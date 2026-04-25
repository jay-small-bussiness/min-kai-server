# account-plan

最終更新: 2026-04-26

このファイルは Ver1.0 の `Account` / `account_users` / `voice_search_usage` と
`/api/account/plan` の最小仕様をまとめる。

## 1. 対象範囲

- `user_id` は client 生成 UUID 文字列を使う
- server は `Account` を source of truth として実効プランを返す
- Ver1.0 で扱う実効プランは `Free` と `Solo`
- `Family` の販売・同期は Ver1.0 の本格運用対象外

## 2. テーブル

### accounts

- `id`
- `account_uuid`
- `plan_type`
  - `free`
  - `solo`
- `status`
  - `active`
  - `cancel_scheduled`
  - `expired`
- `expires_at`
- `created_at`
- `updated_at`

### account_users

- `id`
- `account_id`
- `user_id`
- `linked_at`
- `unlinked_at`
- `user_id` には `UNIQUE` 制約を付ける

### voice_search_usage

- `id`
- `user_id`
- `used_at`
- `created_at`
- `user_id` 単位で Free の日次利用回数を管理する
- 日次判定は JST 基準で行う

## 3. 実効プラン判定

- `plan_type = solo`
- `status` が `active` または `cancel_scheduled`
- `expires_at` が現在時刻より後

上記をすべて満たす場合は `Solo` を返す。
それ以外は `Free` を返す。

## 4. GET /api/account/plan

- 入力: `user_id`
- `query.user_id` または `X-User-ID` header から受け取る
- 不正な UUID は `400`
- `user_id` が無い場合は safe response として `Free` を返す
- 未登録 `user_id` の場合は `accounts` と `account_users` を自動作成する
- 返却時は `buildPlanResponse(plan, userId)` 相当のレスポンス契約を維持する

## 5. POST /api/voice-search/usage

- 入力: `user_id`
- Free 時のみ利用記録を追加する
- Solo 時は利用記録を追加しない
- 既存レスポンス契約は維持する
