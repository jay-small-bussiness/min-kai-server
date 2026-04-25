# 2026-04-25 P0-4 sync-context separation

## 対象

- `docs/spec/total_todo.md` の P0-4
- 旧 `sync-context` 依存を Ver1.0 仕様から切り離す

## 確認内容

Ver1.0 の UserID / Account 最小仕様では、`UserID` の正は `IUserIdService` が生成・保持する UUID である。  
この前提に対して、`/me/sync-context` や `AuthApiService` から `UserID` を取得する依存が、現在の起動・プラン取得・音声検索フローに残っていないか確認した。

## 調査結果

`AuthApiService.GetSyncContextAsync()` の実使用参照は無かった。

確認できた箇所:

- `MauiProgram.cs` に DI 登録が残っていた
- `IAuthApiService.cs` / `AuthApiService.cs` / `SyncContextDto.cs` は将来用コードとして残っていた
- 起動フロー、`/api/account/plan`、`/api/voice-search/usage`、`VoiceSearchViewModel` 側から `GetSyncContextAsync()` は呼ばれていなかった

## 実施内容

- `MauiProgram.cs` から `AddHttpClient<IAuthApiService, AuthApiService>()` を削除
- `IAuthApiService.cs` に「Ver1.0 現行フローでは使わない」コメントを追加
- `AuthApiService.cs` に「将来用・現行フローでは未使用」コメントを追加
- `SyncContextDto.cs` に「将来用 DTO・現行フローでは source of truth にしない」コメントを追加

## 判断

- `AuthApiService` 系は削除せず残置
- ただし Ver1.0 の現行 runtime flow からは切り離し済み
- `user_id` は引き続き `IUserIdService` を正とし、`/me/sync-context` には依存しない

## 影響確認

1. アプリ起動
2. `SplashPage` 通過後に通常どおりプラン取得
3. VoiceSearch で Free 時の残回数消費
4. DB で Solo に変更して前面復帰し、無制限化
5. DB で Free に戻して前面復帰し、Free 制限再開

上記 1-5 は確認済み。  
`GetSyncContextAsync()` の未使用確認はコード検索前提で、Visual Studio など開発側確認項目とした。

## 結論

P0-4 は完了。  
Ver1.0 の起動・プラン取得・音声検索フローは、旧 `sync-context` 依存から切り離されている。
