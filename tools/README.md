# 運用ツール（GOさんのPC用バッチファイル）

コマンドの手打ち・貼り付けミスをなくすための、ダブルクリックで動くツール集。
すべて GOさんのPC（`C:\Users\n9-f\.line-harness\apps\worker` がある環境）で使う。

## 初回セットアップ（1回だけ）

コマンドプロンプトで以下を実行して、3つのバッチをPCに保存する：

```bat
cd C:\Users\n9-f\hacos-deploy
curl -L -o deploy.bat https://raw.githubusercontent.com/goup55/HACOS-/main/tools/deploy.bat
curl -L -o rollback.bat https://raw.githubusercontent.com/goup55/HACOS-/main/tools/rollback.bat
curl -L -o report-kaisuken.bat https://raw.githubusercontent.com/goup55/HACOS-/main/tools/report-kaisuken.bat
```

以後は `C:\Users\n9-f\hacos-deploy` のファイルをダブルクリックするだけ。

## 各ツールの役割

| ファイル | 何をする | いつ使う |
|---|---|---|
| `deploy.bat` | GitHub mainの最新ソースを本番へ反映（取得→KV→バックアップ→置換→デプロイを全自動） | Claudeが「mainにマージしたので本番反映してください」と言ったとき |
| `rollback.bat` | 直前のデプロイを取り消してWorkerを1つ前に戻す | デプロイ後に不具合が出たとき |
| `report-kaisuken.bat` | 指定月の回数券利用を人ごとに集計（回数×¥2,000） | 月初・月末の現金照合のとき |

## 注意

- `deploy.bat` は **mainブランチの内容**を反映する。マージ前のブランチは反映されない
- D1マイグレーション（テーブル追加など）が必要な回は、Claudeが事前に個別コマンドを案内する（deploy.batには含まれない）
- デプロイ後の表示確認は必ず**LINEアプリを完全終了→再起動**してから
- 月次のセッション登録は `line-reservation/migrations/TEMPLATE-monthly-sessions.sql` を参照
  （日程をClaudeに伝えれば登録用SQLを作成します）
