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

### response contract

`GET /api/account/plan` の response は、Ver1.0 では以下の top-level fields を正式契約とする。

- `plan`
- `features`
- `restrictionNotice`
- `screenHelp`

#### plan

- 型: `string`
- nullability: non-null
- 許可値: `Free` | `Solo` | `Family`
- safe default: `Free`
- Ver1.0 における意味:
  `user_id` に紐づく `Account` から server が解決した実効プラン。
  unknown plan は server が返さない前提とする。

#### features

- 型: `object`
- nullability: non-null
- safe default:
  ```json
  {
    "sync": false,
    "voiceSearch": {
      "trialActive": false,
      "trialEndsAt": null,
      "dailyLimit": 5,
      "remainingToday": 0,
      "restricted": false
    }
  }
  ```
- Ver1.0 における意味:
  プランに紐づく feature 状態を返す。

#### features.sync

- 型: `boolean`
- nullability: non-null
- safe default: `false`
- Ver1.0 における意味:
  `Family` のときだけ `true`。
  Ver1.0 では sync は実質未使用だが、後方互換のため返し続ける。

#### features.voiceSearch

- 型: `object`
- nullability: non-null
- safe default:
  ```json
  {
    "trialActive": false,
    "trialEndsAt": null,
    "dailyLimit": 5,
    "remainingToday": 0,
    "restricted": false
  }
  ```
- Ver1.0 における意味:
  音声検索の server 側判定状態。
  Free の日次回数制限、試用状態、残回数を表す。
  client DTO が nullable を許容していても、server contract としては non-null object を正式仕様とする。

#### features.voiceSearch.trialActive

- 型: `boolean`
- nullability: non-null
- safe default: `false`
- Ver1.0 における意味:
  Free プランの試用期間が有効かどうかを示す。

#### features.voiceSearch.trialEndsAt

- 型: `string | null`
- nullability: nullable
- safe default: `null`
- Ver1.0 における意味:
  試用期間終了日時。
  試用期間を使わない場合または未設定の場合は `null` を許容する。

#### features.voiceSearch.dailyLimit

- 型: `number`
- nullability: non-null
- safe default: `5`
- Ver1.0 における意味:
  Free プランの 1 日あたり音声検索上限回数。

#### features.voiceSearch.remainingToday

- 型: `number`
- nullability: non-null
- safe default: `0`
- Ver1.0 における意味:
  JST 基準当日における残回数。

#### features.voiceSearch.restricted

- 型: `boolean`
- nullability: non-null
- safe default: `false`
- Ver1.0 における意味:
  現在の実効プランと当日利用状況に基づき、音声検索を制限すべき状態かどうかを示す。

#### restrictionNotice

- 型: `object`
- nullability: non-null
- safe default:
  ```json
  {
    "title": "",
    "body": "",
    "campaignId": "",
    "actions": []
  }
  ```
- Ver1.0 における意味:
  client 側でプラン制限や補助メッセージを表示するための notice metadata。
  client DTO が nullable を許容していても、server contract としては non-null object を正式仕様とする。

#### restrictionNotice.title

- 型: `string`
- nullability: non-null
- safe default: `""`
- Ver1.0 における意味:
  表示タイトル。

#### restrictionNotice.body

- 型: `string`
- nullability: non-null
- safe default: `""`
- Ver1.0 における意味:
  表示本文。

#### restrictionNotice.campaignId

- 型: `string`
- nullability: non-null
- safe default: `""`
- Ver1.0 における意味:
  notice 識別子。
  client Ver1.0 では現状未使用だが、後方互換のため返してよい。

#### restrictionNotice.actions

- 型: `array`
- nullability: non-null
- safe default: `[]`
- Ver1.0 における意味:
  notice に紐づく action 一覧。

#### restrictionNotice.actions[].type

- 型: `string`
- nullability: non-null
- safe default: `""`
- Ver1.0 における意味:
  action 種別。
  client Ver1.0 では `dismiss` を使用する。

#### restrictionNotice.actions[].label

- 型: `string`
- nullability: non-null
- safe default: `""`
- Ver1.0 における意味:
  action 表示ラベル。

#### client Ver1.0 における restrictionNotice 使用範囲

- 使用する項目:
  `title`
  `body`
  `actions[].type`
  `actions[].label`
- 現状未使用:
  `campaignId`

#### client-side safety rule

- server contract では `restrictionNotice`, `restrictionNotice.actions`, `screenHelp` は non-null を前提とする
- ただし client は defensive に扱う
- `restrictionNotice == null` の場合は notice を表示しない
- `restrictionNotice.actions == null` の場合は empty list として扱う
- `restrictionNotice.actions == []` の場合も落とさない
- `dismiss` action が無い場合は `dismissLabel = "OK"` を使う
- `title` が null / 空白の場合は `お知らせ` を使う
- `body` が null の場合は空文字 `""` を使う
- `screenHelp == {}` は safe default として何もしない

#### screenHelp

- 型: `object map`
- nullability: non-null
- safe default: `{}`
- Ver1.0 における意味:
  画面別ヘルプ metadata。
  Ver1.0 では empty object `{}` を safe default として許容する。
  client DTO が nullable を許容していても、server contract としては non-null object map を正式仕様とする。

### example response

#### Free

```json
{
  "plan": "Free",
  "features": {
    "sync": false,
    "voiceSearch": {
      "trialActive": false,
      "trialEndsAt": "2026-03-01T00:00:00Z",
      "dailyLimit": 5,
      "remainingToday": 2,
      "restricted": false
    }
  },
  "restrictionNotice": {
    "title": "Voice search available",
    "body": "Voice search is available within today's Free-plan limit.",
    "campaignId": "voice-limit-available",
    "actions": [
      {
        "type": "dismiss",
        "label": "OK"
      }
    ]
  },
  "screenHelp": {}
}
```

#### Solo

```json
{
  "plan": "Solo",
  "features": {
    "sync": false,
    "voiceSearch": {
      "trialActive": false,
      "trialEndsAt": null,
      "dailyLimit": 5,
      "remainingToday": 5,
      "restricted": false
    }
  },
  "restrictionNotice": {
    "title": "Voice search available",
    "body": "Your current plan can use voice search without Free-plan restrictions.",
    "campaignId": "voice-search-available",
    "actions": [
      {
        "type": "dismiss",
        "label": "OK"
      }
    ]
  },
  "screenHelp": {}
}
```

#### Family

```json
{
  "plan": "Family",
  "features": {
    "sync": true,
    "voiceSearch": {
      "trialActive": false,
      "trialEndsAt": null,
      "dailyLimit": 5,
      "remainingToday": 5,
      "restricted": false
    }
  },
  "restrictionNotice": {
    "title": "Voice search available",
    "body": "Your current plan can use voice search without Free-plan restrictions.",
    "campaignId": "voice-search-available",
    "actions": [
      {
        "type": "dismiss",
        "label": "OK"
      }
    ]
  },
  "screenHelp": {}
}
```

## 5. POST /api/voice-search/usage

- 入力: `user_id`
- Free 時のみ利用記録を追加する
- Solo 時は利用記録を追加しない
- 既存レスポンス契約は維持する
