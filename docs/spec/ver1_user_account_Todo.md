# Ver1.0 UserID / Account 実装Todo

## A. すぐ実装すべきTodo
- [ ] `UserID` の生成・保存・取得を 1 箇所に集約する  
対象ファイル候補: `client/ShoppingList002/ShoppingList002/Services/` に `IUserIdService.cs`, `UserIdService.cs` 新規, `MauiProgram.cs`, `Views/SplashPage.xaml.cs`, `Models/Sync/SyncContext.cs`

- [ ] 初回起動時に `Preferences` から `user_id` を取得し、未存在なら UUID を生成して保存する  
対象ファイル候補: `Views/SplashPage.xaml.cs`, `Services/InitializationService.cs`, `Services/UserIdService.cs` 新規

- [ ] `SyncContext.UserId` の初期化元を「クライアント生成 UUID」に統一する  
対象ファイル候補: `Models/Sync/SyncContext.cs`, `Services/Sync/AccountPlanRefreshService.cs`, `Services/Sync/AuthApiService.cs`

- [ ] `/api/account/plan` 呼び出し時に必ず `user_id` を送る  
対象ファイル候補: `Services/Sync/AccountPlanApiService.cs`

- [ ] `/api/voice-search/usage` 呼び出し時に必ず `user_id` を送る  
対象ファイル候補: `Services/Sync/VoiceSearchUsageApiService.cs`, `ViewModels/VoiceSearchViewModel.cs`

- [ ] アプリ起動時と前面復帰時に `/api/account/plan` を再取得する  
対象ファイル候補: `App.xaml.cs`, `Views/SplashPage.xaml.cs`, 必要なら `VoiceSearchPage.xaml.cs`

- [ ] Solo 購入成功後に `user_id`, `store`, `product_id`, `purchaseToken` をサーバー送信する API クライアントを追加する  
対象ファイル候補: `Services/Sync/IBillingApiService.cs` 新規, `Services/Sync/BillingApiService.cs` 新規, `MauiProgram.cs`, 購入処理を持つ ViewModel / Page

- [ ] 「購入を復元」操作から既存購入情報を再同期できる UI とコマンドを追加する  
対象ファイル候補: `Views/SettingsPage.xaml`, `Views/SettingsPage.xaml.cs`, `ViewModels/SettingsPageViewModel.cs`, `Services/Sync/BillingApiService.cs` 新規

- [ ] `/api/account/plan` の結果に応じて、音声検索制限を `Free` のみ適用する  
対象ファイル候補: `ViewModels/VoiceSearchViewModel.cs`, `Models/Dto/AccountPlanResponseDto.cs`

- [ ] `Free → Solo` 検知後は音声検索回数をカウントしない動作へ切り替える  
対象ファイル候補: `ViewModels/VoiceSearchViewModel.cs`

- [ ] `Solo → Free` 検知後は、その検知時点以後の利用分を `Free` としてカウント開始する  
対象ファイル候補: `ViewModels/VoiceSearchViewModel.cs`  
補足: 現在のローカル optimistic カウントがあるため、プラン遷移時の基準時刻またはローカルカウンタ初期化方針を実装に落とす必要あり

- [ ] QR マスター移行データに `user_id` を含め、インポート時に新端末へ引き継ぐ  
対象ファイル候補: QR 移行関連サービス / ViewModel / Page 一式  
補足: まだ専用実装が薄い場合は、新規 `MigrationService` 系の追加が必要

- [ ] サーバーに `accounts` テーブルを追加する  
対象ファイル候補: `server/server.js` または DB migration スクリプト新規

- [ ] サーバーに `account_users` テーブルを追加し、`user_id` に `UNIQUE` 制約を付ける  
対象ファイル候補: `server/server.js` または DB migration スクリプト新規

- [ ] サーバーの `voice_search_usage` を Ver1.0 仕様どおり `user_id` ベースで定義する  
対象ファイル候補: `server/server.js` または DB migration スクリプト新規

- [ ] `/api/account/plan` で、該当 `user_id` の `Account` が無ければ新規 `Account` と `account_users` を自動作成する  
対象ファイル候補: `server/server.js`

- [ ] `/api/account/plan` で `plan_type / status / expires_at` から実効プランを判定して返す  
対象ファイル候補: `server/server.js`

- [ ] Solo 購入情報受信 API を追加する  
対象ファイル候補: `server/server.js`  
例: `POST /api/billing/purchases/sync`

- [ ] `purchaseToken` を Google Play Developer API で検証する処理を実装する  
対象ファイル候補: `server/` 配下に `billing/googlePlay.js` 等を新規, `server/server.js`

- [ ] 検証結果に基づいて `Account.plan_type / status / expires_at` を更新する  
対象ファイル候補: `server/server.js`, 必要なら `server/services/accountPlanService.js` 新規

- [ ] `/api/voice-search/usage` は `Free` の時だけ記録するようにする  
対象ファイル候補: `server/server.js`  
補足: `Solo` 時は無視するか、400/409 を返すかは要決定

## B. 既存実装の修正Todo
- [ ] `user_id` の生成責務をサーバー依存や仮値依存から切り離し、クライアント UUID に置き換える  
対象ファイル候補: `Services/Sync/AuthApiService.cs`, `Services/Sync/AccountPlanRefreshService.cs`, `Views/SplashPage.xaml.cs`

- [ ] `AuthApiService.GetSyncContextAsync()` の責務を見直す  
対象ファイル候補: `Services/Sync/AuthApiService.cs`  
補足: Ver1.0 仕様では `user_id` はクライアント生成なので、`/me/sync-context` に依存しない形へ整理が必要

- [ ] `SyncContext` の `UserId` 型を UUID 文字列前提へ見直す  
対象ファイル候補: `Models/Sync/SyncContext.cs`, `Models/Dto/SyncContextDto.cs`, 関連 API サービス全般  
補足: 現在は `int?` 前提の可能性が高い

- [ ] `AccountPlanApiService` の `user_id` 送信を数値 ID 前提から UUID 文字列前提へ修正する  
対象ファイル候補: `Services/Sync/AccountPlanApiService.cs`

- [ ] `VoiceSearchUsageApiService` の `user_id` 送信を UUID 文字列前提へ修正する  
対象ファイル候補: `Services/Sync/VoiceSearchUsageApiService.cs`, `Services/Sync/IVoiceSearchUsageApiService.cs`

- [ ] `VoiceSearchViewModel` のローカル回数管理を、`Free ↔ Solo` 遷移に耐えるよう修正する  
対象ファイル候補: `ViewModels/VoiceSearchViewModel.cs`  
補足: 現在の `Preferences` ベース当日カウントは、Solo から Free への復帰時にそのまま使うと仕様とずれる可能性がある

- [ ] `App.xaml.cs` の前面復帰リフレッシュを、仕様上の正式動作として整理する  
対象ファイル候補: `App.xaml.cs`

- [ ] `family_id` 前提の同期コードを Ver1.0 範囲外として分離するか、誤って UserID/Account 仕様に混ざらないよう整理する  
対象ファイル候補: `Services/Sync/ShoppingListApiService.cs`, `Services/Sync/SyncService.cs`, `ViewModels/CandidateListPageViewModel.cs`, `Models/Sync/SyncContext.cs`

- [ ] `ShoppingListApiService` の `family_id=1` ハードコードを除去または Ver1.0 対象外コードとして隔離する  
対象ファイル候補: `Services/Sync/ShoppingListApiService.cs`

- [ ] `CandidateListPageViewModel` など `FamilyId` に依存する箇所が Ver1.0 の UserID/Account 実装に影響しないよう整理する  
対象ファイル候補: `ViewModels/CandidateListPageViewModel.cs`, `Services/ShoppingListService.cs`

- [ ] サーバー側に `family_id` ベースの `voice_search_usage` 定義や参照が残っていれば `user_id` ベースへ変更する  
対象ファイル候補: `server/server.js`, DB migration 一式  
補足: 現在のコード上は `user_id` 化済みの可能性があるが、DDL と運用を再確認すべき

- [ ] `/api/account/plan` が「実効プラン」ではなく単純フラグ返却になっている部分があれば修正する  
対象ファイル候補: `server/server.js`, `Models/Dto/AccountPlanResponseDto.cs`

## C. 後回しでよいTodo
- [ ] Google Play 以外のストア対応  
対象ファイル候補: `server/billing/` 新規, クライアント購入同期 API

- [ ] Billing webhook / RTDN などサーバー主導のリアルタイム更新  
対象ファイル候補: `server/` 配下の webhook 実装新規

- [ ] 課金履歴テーブル `billing_purchases` の追加  
対象ファイル候補: DB migration 新規, `server/server.js`  
補足: 監査用途としては有用だが、Ver1.0 最小では後回し可

- [ ] Family プラン販売、FamilyID、本格同期  
対象ファイル候補: `Models/Sync/SyncContext.cs`, `Services/Sync/ShoppingListApiService.cs`, `server/server.js`

- [ ] QR 移行時の旧端末無効化や権利複製防止  
対象ファイル候補: QR 移行関連一式

- [ ] 再インストール時の再同定  
対象ファイル候補: UserID 管理サービス, 認証導入後の account link 処理

## D. 実装前に確認すべき点
- [ ] 必須: `user_id` の型を `UUID文字列` に統一するか  
対象ファイル候補: `Models/Sync/SyncContext.cs`, `Models/Dto/SyncContextDto.cs`, `server/server.js`

- [ ] 必須: `/api/account/plan` が `GET` のまま Account 自動作成の副作用を持ってよいか  
対象ファイル候補: `server/server.js`  
補足: 許容しない場合は `POST /api/account/resolve` を別に切る必要あり

- [ ] 必須: `Account.status` の正式 enum を何にするか  
候補: `active`, `cancel_scheduled`, `expired`

- [ ] 必須: `expires_at` の意味を「現在契約期間の終了日時」で固定するか  
対象ファイル候補: `docs/spec/ver1_user_account_spec.md`, `server/server.js`

- [ ] 必須: `Solo` 時の `/api/voice-search/usage` を「記録しない」「受けても無視」「エラー返却」のどれにするか  
対象ファイル候補: `server/server.js`, `ViewModels/VoiceSearchViewModel.cs`

- [ ] 必須: `Solo → Free` 検知時のローカル音声検索カウントをどう初期化するか  
対象ファイル候補: `ViewModels/VoiceSearchViewModel.cs`  
補足: サーバーだけでなくクライアントの optimistic 制御も仕様整合が必要

- [ ] 必須: Google Play からクライアントが再同期時に取得できる購入情報の最小セット  
対象ファイル候補: クライアント購入処理, `Services/Sync/BillingApiService.cs` 新規

- [ ] 後回し可: `cancel_at_period_end` を Ver1.0 で持つか  
対象ファイル候補: `accounts` テーブル定義, `server/server.js`

- [ ] 後回し可: `billing_purchases` 履歴テーブルを Ver1.0 で作るか  
対象ファイル候補: DB migration 新規

- [ ] 後回し可: Family 系コードを完全削除するか、Ver1.0 対象外として残置するか  
対象ファイル候補: `Services/Sync/ShoppingListApiService.cs`, `Services/Sync/SyncService.cs`, `ViewModels/CandidateListPageViewModel.cs`
