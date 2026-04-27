# total_todo

最終更新: 2026-04-24

このファイルは、現時点の client 実装、既存メモ、`ver1_user_account_spec.md`、`ver1_user_account_Todo.md`、音声検索回数制限まわりの直近差分をまとめた全体 Todo です。  
優先順位順に並べています。Version 1.0 の範囲外は末尾に分離しています。

---

## P0 今すぐ着手

### 1. client の `UserID` をクライアント生成 UUID に統一する

状態: 完了

- `UserID` の生成・保存・取得を 1 箇所に集約する
- 初回起動時に `Preferences` から `user_id` を取得し、未存在なら UUID を生成して保存する
- `SyncContext.UserId` の初期化元をクライアント生成 UUID に統一する
- `SplashPage` の仮実装 `UserId = 1` を撤去する
- `SyncContext` と DTO の `UserId` 型を `int?` から UUID 文字列前提へ見直す

対象候補:

- `ShoppingList002/ShoppingList002/Models/Sync/SyncContext.cs`
- `ShoppingList002/ShoppingList002/Models/Dto/SyncContextDto.cs`
- `ShoppingList002/ShoppingList002/Views/SplashPage.xaml.cs`
- `ShoppingList002/ShoppingList002/Services/` に `IUserIdService.cs`, `UserIdService.cs` 新規
- `ShoppingList002/ShoppingList002/MauiProgram.cs`

### 2. `/api/account/plan` と `/api/voice-search/usage` の `user_id` 送信を UUID 仕様へ合わせる

状態: 完了

- `/api/account/plan` 呼び出し時に必ず `user_id` を送る
- `/api/voice-search/usage` 呼び出し時に必ず `user_id` を送る
- API client の `int userId` 前提を UUID 文字列前提へ修正する

対象候補:

- `ShoppingList002/ShoppingList002/Services/Sync/AccountPlanApiService.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/VoiceSearchUsageApiService.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/IVoiceSearchUsageApiService.cs`
- `ShoppingList002/ShoppingList002/ViewModels/VoiceSearchViewModel.cs`

### 3. 音声検索の Free / Solo 切替ロジックを仕様どおりに閉じる

状態: 完了

- `Free` のみ回数制限対象とする
- `Solo` 中は音声検索回数を制限判定に使わない
- `Free → Solo` 検知後は回数カウントを止める
- `Solo → Free` 検知後は、その時点以後の利用分だけを Free としてカウント開始する
- 現在の JST 日次ローカル optimistic カウントを、プラン遷移時に破綻しない設計へ直す
- 直近差分の account plan メッセージ配信、前面復帰 refresh、残回数 UI 更新をビルド・動作確認まで完了させる

対象候補:

- `ShoppingList002/ShoppingList002/ViewModels/VoiceSearchViewModel.cs`
- `ShoppingList002/ShoppingList002/Views/VoiceSearchPage.xaml.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/AccountPlanRefreshService.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/IAccountPlanRefreshService.cs`
- `ShoppingList002/ShoppingList002/App.xaml.cs`

### 4. 旧 `sync-context` 依存を Ver1.0 仕様から切り離す

状態: 完了

- `AuthApiService.GetSyncContextAsync()` の責務を見直す
- `user_id` を `/me/sync-context` に依存しない形へ整理する
- Ver1.0 の UserID / Account 最小仕様に不要な認証前提を client 実装から外す

対象候補:

- `ShoppingList002/ShoppingList002/Services/Sync/AuthApiService.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/IAuthApiService.cs`
- `ShoppingList002/ShoppingList002/Models/Dto/SyncContextDto.cs`

---

## P1 Version 1.0 成立に必要

### 5. app 起動時と前面復帰時の account plan 再取得を正式動作として固める

状態: 完了

- 起動時 refresh の流れを整理する
- 前面復帰時 refresh を正式仕様として確定する
- refresh 失敗時の cache 利用と safe mode の扱いを整理する

対象候補:

- `ShoppingList002/ShoppingList002/Views/SplashPage.xaml.cs`
- `ShoppingList002/ShoppingList002/App.xaml.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/AccountPlanRefreshService.cs`

### 6. server に Ver1.0 の `Account` / `account_users` / `voice_search_usage` を実装する

状態: 完了

- `accounts` テーブルを追加する
- `account_users` テーブルを追加し、`user_id` に `UNIQUE` 制約を付ける
- `voice_search_usage` を Ver1.0 仕様どおり `user_id` ベースで定義する
- `/api/account/plan` で `user_id` 未登録時に `Account` と `account_users` を自動作成する
- `/api/account/plan` で `plan_type / status / expires_at` から実効プランを返す
- `/api/voice-search/usage` を Free 時のみ記録する

対象候補:

- `server/server.js`
- DB migration スクリプト新規

### 7. `/api/account/plan` の response 契約を client 実装と揃える

状態: 完了

- `plan` を実効プランとして返す
- `features.voiceSearch` の `trialActive`, `trialEndsAt`, `dailyLimit`, `remainingToday`, `restricted` を正式化する
- `restrictionNotice` を正式化する
- `screenHelp` を正式化する
- client DTO と server response のズレを解消する

対象候補:

- `docs/spec/ver1_user_account_spec.md`
- `docs/implementation/server-todo.md`
- `ShoppingList002/ShoppingList002/Models/Dto/AccountPlanResponseDto.cs`
- `server/server.js`

### 8. restriction notice / help metadata の安全ルールを決める

状態: 完了

- `navigate` action の allowlist を定義する
- 未知 action や未知 route の safe default を定義する
- help URL の扱いを整理する

対象候補:

- `docs/implementation/server-todo.md`
- `docs/spec/implementation-checklist.md`
- `server/server.js`
- client の notice / help 表示側

---

## P2 課金反映の最小フロー

### 9. Solo 購入情報同期 API を client / server に追加する

- client から `user_id`, `store`, `product_id`, `purchaseToken` を送信する API client を追加する
- server で購入情報受信 API を追加する
- Google Play 検証結果を source of truth として `Account.plan_type / status / expires_at` を更新する
- 購入反映後に client が `/api/account/plan` を再取得して UI へ反映する

対象候補:

- `ShoppingList002/ShoppingList002/Services/Sync/IBillingApiService.cs` 新規
- `ShoppingList002/ShoppingList002/Services/Sync/BillingApiService.cs` 新規
- 購入処理を持つ ViewModel / Page
- `server/server.js`
- `server/billing/googlePlay.js` 新規
- `server/services/accountPlanService.js` 新規候補

### 10. 「購入を復元」操作を追加する

- 設定画面などに「購入を復元」UI を追加する
- 既存購入情報を再同期するコマンドを追加する
- 復元後に account plan を再取得して UI に反映する

対象候補:

- `ShoppingList002/ShoppingList002/Views/SettingsPage.xaml`
- `ShoppingList002/ShoppingList002/ViewModels/SettingsPageViewModel.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/BillingApiService.cs`

---

## P3 Version 1.0 の整合性を上げる

### 11. QR マスター移行で `user_id` を引き継ぐ

- QR エクスポートデータに `user_id` を含める
- インポート時に `user_id` を新端末へ復元する
- Ver1.0 仕様どおり、移行後も旧端末無効化はしない

対象候補:

- QR 移行関連サービス / ViewModel / Page 一式
- 必要なら `MigrationService` 系新規

### 12. Family 前提コードを Ver1.0 対象外として分離する

- `SyncContext` の `FamilyId` 前提が UserID / Account 実装に混ざらないよう整理する
- `ShoppingListApiService` の `family_id=1` ハードコードを除去または対象外として隔離する
- `CandidateListPageViewModel` など Family 依存コードが Ver1.0 仕様に干渉しないよう整理する

対象候補:

- `ShoppingList002/ShoppingList002/Services/Sync/ShoppingListApiService.cs`
- `ShoppingList002/ShoppingList002/Services/Sync/SyncService.cs`
- `ShoppingList002/ShoppingList002/ViewModels/CandidateListPageViewModel.cs`
- `ShoppingList002/ShoppingList002/Models/Sync/SyncContext.cs`

### 13. CandidateCategory の未実装 TODO を処理する

- 名前変更処理
- 並び順変更処理

対象候補:

- `ShoppingList002/ShoppingList002/ViewModels/CandidateCategoryViewModel.cs`

---

## P4 追加確認が必要

### 14. 仕様確認

- `user_id` の型は UUID 文字列で確定してよいか
- `/api/account/plan` が `GET` のまま `Account` 自動作成の副作用を持ってよいか
- `Account.status` の正式 enum を `active`, `cancel_scheduled`, `expired` で確定してよいか
- `expires_at` の意味を「現在契約期間の終了日時」で固定してよいか
- `Solo` 時の `/api/voice-search/usage` を「無視」「記録しない」「エラー返却」のどれにするか
- `Solo → Free` 検知時のローカル音声検索カウントをどう初期化するか
- Google Play から client が再同期時に取得できる購入情報の最小セットは何か

### 15. 実装方針確認

- `cancel_at_period_end` を Ver1.0 で持つか
- `billing_purchases` 履歴テーブルを Ver1.0 で作るか
- Family 系コードを完全削除するか、Version 1.0 対象外として残置するか

---

## 後回し

### 16. Version 1.0 範囲外

- Google Play 以外のストア対応
- Billing webhook / RTDN など server 主導更新
- `billing_purchases` の監査用途強化
- Family プラン販売
- FamilyID の導入
- 本格同期
- QR 移行後の旧端末無効化
- 再インストール時の再同定

---

## 補足

- 直近の最重要ブロックは「client の `UserID` UUID 化」と「音声検索 Free / Solo 切替ロジックの完了」です。
- その次に server の `Account` / `account_users` 実装を揃えないと、client 側だけ整えても仕様どおりの実効プラン判定になりません。
- `ver1_user_account_Todo.md` の内容は大半が引き続き有効ですが、この `total_todo.md` では直近の作業優先度順に並べ替えています。
