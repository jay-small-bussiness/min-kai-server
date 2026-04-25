# UserID / Account / FamilyID に関する Ver1.0 最小仕様

## 1. 目的

Ver1.0 では、音声検索回数制限と Solo 課金状態の管理に必要な最小限の識別子設計を定義する。  
本仕様では `UserID`、`Account`、`FamilyID` の責務を分離し、Ver1.0 時点で実装対象とする範囲を明確にする。

---

## 2. UserID

- `UserID` はクライアント側の利用主体識別子とする。
- アプリ初回起動時にクライアントで UUID を生成する。
- 生成した `UserID` は端末内 `Preferences` に保存する。
- 同一端末では同じ `UserID` を継続利用する。
- Ver1.0 の QR マスター移行では `UserID` を移行データに含め、新端末へ引き継ぐ。
- Ver1.0 では QR 移行後も旧端末は無効化しない。
- Ver1.0 では再インストールや端末初期化により `Preferences` が失われた場合の再同定は扱わない。

### 補足

- Ver1.0 では `UserID` を API 利用主体識別子として使用する。
- 音声検索回数制限の判定単位も `user_id` とする。

---

## 3. Account

- `Account` はサーバー側の契約主体とする。
- 課金状態は `user_id` ではなく `Account` に保持する。
- `UserID` は `Account` に紐づく利用主体として扱う。
- Ver1.0 では 1 `UserID` は 1 `Account` のみに紐づくものとする。
- `/api/account/plan` は `UserID` に対応する `Account` を解決し、現在有効な実効プランを返す。
- 初回の `/api/account/plan` 呼び出し時に、該当 `user_id` に対応する `Account` が存在しない場合、サーバーは新規 `Account` を作成し、`account_users` に紐付ける。

### Ver1.0 で Account に持たせる状態

- `plan_type`
  - `free`
  - `solo`
- `status`
  - `active`
  - `cancel_scheduled`
  - `expired`
- `expires_at`
  - 現在有効な契約期限
- 必要に応じて `cancel_at_period_end` を保持してもよい

### 実効プラン判定

- `plan_type = solo` かつ `status` が有効状態であり、`expires_at` が現在時刻より後であれば `Solo`
- それ以外は `Free`

---

## 4. FamilyID

- `FamilyID` は将来の共有グループ識別子として定義する。
- Ver1.0 では `FamilyID` を実装対象に含めない。
- Ver1.0 では Family プランの販売は行わない。
- Ver1.0 では Family 内の親アカウント、参加ユーザー、共有同期モデルは扱わない。

---

## 5. プラン仕様

### Ver1.0 で扱うプラン

- `Free`
- `Solo`

### 音声検索回数制限

- Ver1.0 では Free プランのみ回数制限の対象とする。
- Solo プランには音声検索回数制限を設けない。

---

## 6. Solo 課金反映の最小フロー

1. ユーザーがアプリをインストールする
2. 初回起動時にクライアントが `UserID` を生成する
3. サーバー側では当該 `UserID` に対応する `Account` を Free として扱う
4. ユーザーが外部プラットフォームで Solo を購入する
5. クライアントが購入情報と `UserID` をサーバーへ送信する
6. サーバーが購入情報を検証する
7. 検証成功時、対応する `Account` を Solo 状態に更新する
8. 以後 `/api/account/plan` は `Solo` を返す

### Solo 解除

- Ver1.0 では以下の状態遷移を扱う
  - `Free → Solo`
  - `Solo 継続`
  - `Solo 解約予約`
  - `Solo 期限切れ → Free`

## 6-1. Solo課金情報の取得と反映（Ver1.0で必要）

- ユーザーがアプリ内で Solo を購入した場合、クライアントは購入成功後に `user_id`, `store`, `product_id`, `purchaseToken` をサーバーへ送信する。
- サーバーは `purchaseToken` を用いて Google Play Developer API で購入状態を検証し、その検証結果を source of truth として `Account` の `plan_type` / `status` / `expires_at` を更新する。
- クライアントは購入反映後に `/api/account/plan` を再取得し、現在有効な実効プランを画面へ反映する。
- クライアントは、アプリ起動時およびアプリが端末で前面に復帰したタイミングで `/api/account/plan` を再取得し、現在有効な実効プランを画面へ反映する。
- さらに、ユーザーによる「購入を復元」操作時に、クライアントは既存購入情報を再同期できるものとする。
- Ver1.0 では Billing API の詳細実装までは扱わないが、「購入情報をクライアントからサーバーへ送る」「サーバーが `purchaseToken` を検証して `Account` を更新する」責務は仕様として明示する。

### 6-2. プラン変更時の音声検索回数制限の扱い

- 音声検索回数制限は、実効プランが `Free` の場合にのみ適用する。
- 実効プランが `Solo` の場合、音声検索回数は制限対象外とし、利用回数を制限判定に使用しない。
- `Free` から `Solo` へ変更された場合、その検知時点以降は音声検索回数をカウントしない。
- `Solo` から `Free` へ変更された場合、その検知時点以降の利用回数を `Free` の回数制限対象としてカウントする。
- Ver1.0 では、プラン変更時に過去の `voice_search_usage` 履歴を削除またはリセットすることは必須としない。
- Ver1.0 の最小実装では、`Solo` 中は `voice_search_usage` を記録しない運用としてよい。

---

## 7. voice_search_usage

- Ver1.0 の音声検索利用記録は `user_id` 単位で管理する。
- `family_id` は持たせない。
- 利用回数制限判定は Free プランに対してのみ行う。

### テーブル例

```sql
CREATE TABLE voice_search_usage (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id CHAR(36) NOT NULL,
    used_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_voice_search_usage_user_used_at (user_id, used_at)
);
```

---

## 8. Ver1.0 の最小テーブル構成

Ver1.0 では以下の 3 テーブルを最小構成とする。

- `accounts`
- `account_users`
- `voice_search_usage`

### accounts

```sql
CREATE TABLE accounts (
    id BIGINT NOT NULL AUTO_INCREMENT,
    account_uuid CHAR(36) NOT NULL,
    plan_type ENUM('free', 'solo') NOT NULL DEFAULT 'free',
    status ENUM('active', 'cancel_scheduled', 'expired') NOT NULL DEFAULT 'active',
    expires_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_accounts_account_uuid (account_uuid)
);
```

### account_users

```sql
CREATE TABLE account_users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    account_id BIGINT NOT NULL,
    user_id CHAR(36) NOT NULL,
    linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unlinked_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_account_users_user_id (user_id),
    KEY idx_account_users_account_id (account_id),
    KEY idx_account_users_user_id (user_id)
);
```

### voice_search_usage

```sql
CREATE TABLE voice_search_usage (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id CHAR(36) NOT NULL,
    used_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_voice_search_usage_user_used_at (user_id, used_at)
);
```

---

## 9. API責務

### GET /api/account/plan

- 入力: `user_id`
- 役割: `user_id` に紐づく `Account` を解決し、現在有効な実効プランを返す
- 該当 `user_id` に対応する `Account` が未作成の場合は、新規 `Account` を作成して `account_users` に紐付けたうえで `Free` を返してよい

### POST /api/billing/...（名称は別途定義）

- 入力: `user_id`、購入情報
- 役割: 外部課金情報をサーバーで検証し、対応する `Account` の課金状態を更新する

### POST /api/voice-search/usage

- 入力: `user_id`
- 役割: Free プラン時の音声検索利用記録を登録する

---

## 10. Ver1.0 で扱わないこと

- QR移行後の旧端末無効化
- 再インストール時の再同定
- Family プラン販売
- Family の親子アカウント構造
- Family 共有同期の詳細仕様
- 複数端末同時利用の厳密制御

---

## 11. Ver1.0 の結論

Ver1.0 では、`UserID` をクライアント生成 UUID により端末識別子として扱い、課金状態はサーバー側 `Account` に保持する。  
`FamilyID` は Ver1.0 では導入せず、音声検索回数制限は Free プランに対して `user_id` 単位で管理する。
