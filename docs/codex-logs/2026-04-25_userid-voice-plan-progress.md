# 2026-04-25 UserID / Voice Plan Progress

## 概要

2026-04-25 時点で、`docs/spec/total_todo.md` の P0-1, P0-2, P0-3 に関する作業を進めた。  
主な対象は以下。

- client 側 `UserID` の UUID 化
- `/api/account/plan` と `/api/voice-search/usage` の `user_id` を UUID 仕様へ変更
- 音声検索の Free / Solo 切替ロジックの整理
- 実機での挙動確認

---

## 1. P0-1 UserID の UUID 化

### 実装

- `IUserIdService` / `UserIdService` を追加
- `Preferences` に `user_id` を保存するよう実装
- 初回未保存時に UUID を生成するよう実装
- `SyncContext.UserId` を `int?` から `string?` に変更
- `SplashPage` の `UserId = 1` 仮実装を撤去
- `MauiProgram` に `IUserIdService` を DI 登録

### 一時確認ログ

確認用に `[UserID-Debug]` prefix 付きの `Debug.WriteLine` を一時追加した。

確認した内容:

- `Preferences` に `user_id` が未保存か
- 未存在時に UUID を新規生成したか
- 取得または生成した `user_id` の値
- `SplashPage` で `SyncContext.UserId` に設定された値

### 実機確認結果

1 回目起動:

- `Preferences` に `user_id` は未保存
- UUID を新規生成
- `SplashPage` で同じ値を `SyncContext.UserId` に設定

2 回目起動:

- `Preferences` から同じ `user_id` を再取得
- 再生成されず継続利用
- `SplashPage` でも同じ値を設定

確認後、`[UserID-Debug]` ログは削除済み。

### 追加確認

スマホ実機で以下も確認済み。

- 一度アンインストール
- Visual Studio から再インストール
- 別の `UserID` が生成される

これは `Preferences` 消失時の再同定を Ver1.0 では扱わないという仕様どおり。

---

## 2. P0-2 API の user_id を UUID 仕様へ変更

### 実装

- `AccountPlanApiService` が `IUserIdService` から `user_id` を取得するよう変更
- `VoiceSearchUsageApiService` が `IUserIdService` から `user_id` を取得するよう変更
- `IVoiceSearchUsageApiService.RecordUsageAsync(int userId)` を `RecordUsageAsync()` に変更
- `VoiceSearchUsageRequestDto` を追加し、`user_id` を UUID 文字列で送るよう変更
- `VoiceSearchViewModel` から `int userId` を直接渡さない形へ変更

### user_id の取得経路

- `UserIdService` が `Preferences` から `user_id` を取得し、未存在なら生成
- `AccountPlanApiService` が `IUserIdService.GetOrCreateUserId()` を呼び、`GET /api/account/plan?user_id=...` に付与
- `VoiceSearchUsageApiService` が `IUserIdService.GetOrCreateUserId()` を呼び、`POST /api/voice-search/usage` の JSON に `user_id` として設定
- `VoiceSearchViewModel` は `user_id` を持たず、usage API 呼び出しだけ行う

### server 側確認

ユーザー確認ベースで以下を確認済み。

- `server.js` 側も UUID 形式の `user_id` を受け取れるよう変更済み
- サーバー側テーブル変更も実施済み
- 実機デバッグで、client 側生成の `int` ではない新しい `UserID` が server 側で更新されることを確認済み

---

## 3. P0-3 音声検索の Free / Solo 切替ロジック

### 実装内容

`VoiceSearchViewModel` に以下を実装。

- Free のときのみ回数制限を適用
- Solo のときは `remainingToday` に関係なく常に使用可能
- `AccountPlanUpdatedMessage` を受けたときに plan 更新を反映
- Free → Solo ではローカルカウント消費を停止
- Solo → Free では、その時点でローカル JST 日次カウントをリセットして再開
- `effectiveRemaining = min(serverRemaining, dailyLimit - localUsedToday)` で server 値とローカル optimistic 値を整合

### 実機確認結果

1. Free 状態

- `voiceSearch.remainingToday` が減る
- 0 で制限される

2. DBeaver で Solo に変更

- アプリ前面復帰
- VoiceSearch 画面が Solo 表示
- 残回数に関係なく使用可能

3. DBeaver で Free に戻す

- アプリ前面復帰
- Free 表示に戻る
- そこから Free として回数制限が再開

1, 2, 3 とも問題なく確認できた。

---

## 4. 制限到達 notice の不具合と修正

### 問題

Free 状態で `0/5` に到達したあと、

- もう一度だけ検索動作を受け付けた直後に
- `Voice search available` 側のメッセージが出る

という問題があった。

期待値は以下だった。

- `1/5 → 0/5` になった時点で notice が出る
- 表示文言は
  - `本日のFreeプランの音声検索回数は上限に達しています`
  - `音声検索は本日分を使い切りました。\nカテゴリー一覧から商品を選んで追加できます。`

### 修正

`VoiceSearchViewModel` を修正し、

- `ApplyOptimisticVoiceSearchUsageAsync()` で `remainingToday` が 0 になった瞬間に
- client 側で制限到達 notice を生成
- その場で `RestrictionNoticeRequested` を発火

するよう変更した。

さらに、Free かつ制限到達状態の plan 正規化時に generic notice を制限到達 notice で上書きするようにした。

### 修正後確認

ユーザー確認ベースで、

- `1/5 → 0/5` の時点で
- 正しい Free 上限制限メッセージが出る

ことを確認済み。

---

## 5. ビルド状況

`dotnet build ShoppingList002.sln` は継続して失敗している。  
ただし残エラーは今回の `UserID` / P0-2 / P0-3 作業ではなく、Windows ターゲットで Android 名前空間を直接参照している既存コードが原因。

主な残エラー対象:

- `Services/AndroidKanaService/AndroidUserDictService.cs`
- `Services/AndroidKanaService/UserDictService.cs`
- `Services/UserDictService.cs`
- `ViewModels/Base/BaseVoiceAddViewModel.cs`
- `ViewModels/ShoppingListPageViewModel.cs`

---

## 6. 現在の進捗

- P0-1: 完了
- P0-2: 完了
- P0-3: 実装・実機確認まで完了
- P1-1: 実装・実機確認まで完了
- restriction notice / help metadata safety rule: 完了
- P0-4 以降: 未着手

---

## 7. 補足

- `docs/spec/total_todo.md` では P0-1 と P0-2 を完了済みへ更新済み
- P0-3 の完了状態は、必要に応じて次回 `total_todo.md` へ反映する
