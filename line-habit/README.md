# HACOS × HMC 習慣トラッキング 実装ガイド

会員が1日10秒で「🏃動いた／🥗食べ方に気をつけた＋ひとことメモ」を記録するLIFFアプリ。
予約システム（`line-reservation/`）と**同じWorker・同じD1・同じLINEログインチャネル**に載せる。
追加インフラは不要。毎週月曜18時（JST）にスタッフへ週間ダイジェストがLINEで届き、
一人ひとりに「見てるよ」を返す運用の起点にする。

> 予約システムのREADMEの教訓（`/api/liff/`パス必須・KV配信・`pnpm run deploy`）は
> すべてこちらにも当てはまる。先に `line-reservation/README.md` を読むこと。

## ファイル構成

```
line-habit/
├── schema.sql            # habit_logs テーブル（既存 line-harness DB に追加）
├── liff/
│   └── habit.html        # LIFF 記録ページ
└── src/
    └── habit-routes.js   # Hono ルート＋週間ダイジェスト（ハーネスに追加）
```

## 機能

- **記録**: 今日／昨日のみ記録・上書き可（それ以前は不可。習慣化の意味が薄れるため）
- **表示**: 連続記録日数・今月の記録日数・今月動いた日数・直近7日のドット。
  連続日数が節目（3・7・14日、以降30日ごと）に達した保存時は画面内でお祝い表示。
  昨日が未記録なら「昨日」タブにドット表示。フッター文言は状態（継続中／復帰）で出し分け
- **週間ダイジェスト**: 毎週月曜18時(JST)に先週月〜日の集計＋メモをスタッフLINEへ。
  末尾に「⚠️ 先週は記録なし（声かけ候補）」＝先週ゼロだが直近28日には記録があった人を列挙。
  集計対象も声かけ候補も誰もいない週は送らない
- **返信直行リンク（2026-07-17）**: ダイジェスト・離脱アラートの各メンバーに
  「↩ 返信: {管理画面URL}/chats?friend=...」を添付。押すと管理画面のチャット受信箱で
  その人との会話が開き、「見てるよ」を返す摩擦が10秒になる。
  friendIdは friends テーブル（ハーネス本体管理）から解決し、解決できない人・
  ADMIN_PUBLIC_URL未設定時はリンクなしのテキストのみに静かに落ちる。
  **設定変更は不要**（ADMIN_PUBLIC_URLはwrangler.tomlに設定済み）。
  管理画面のログインが切れているとリンクから会話まで自動では届かないため、
  「ログイン後にもう一度リンクを押す」旨の注記をメッセージ末尾に自動付与
- **離脱アラート（毎日）**: 3日以上続けていた人について「昨日・一昨日が空白、かつ今日も
  18時時点でまだ記録なし」の日に1回だけスタッフへ通知。判定条件が特定の1日しか成立しない
  形のため、空白が続いても再送されない。なお同じ人が週の途中で離脱アラートに出て、
  月曜のダイジェストの「声かけ候補」にも再度出ることがある（別々の判定なので仕様どおり）
- **通知の鉄則**: 会員本人への自動送信は絶対にしない。通知先はSTAFF_USER_IDSのみ（HACOSの運用ルール）
- **扱わないもの**: カロリー・体重・数値目標。メモがスタッフに共有されることは画面に明記済み

## セットアップ手順

### 1. D1 テーブル作成（既存DBに追加）

```bash
wrangler d1 execute line-harness --file=line-habit/schema.sql --remote
```

### 2. LIFFアプリを新規作成（LINE Developers）

「ハコスラインログイン」チャネル > LIFFタブ > 追加：
- サイズ: Full
- エンドポイントURL: `https://line-harness.hacos.workers.dev/liff/habit`
- Scope: `profile`, `openid`

発行された LIFF ID を Secret に登録：

```bash
wrangler secret put HABIT_LIFF_ID
```

（`CHANNEL_ACCESS_TOKEN` / `LINE_LOGIN_CHANNEL_ID` / `STAFF_USER_IDS` は予約システムと共用。追加不要）

### 3. ハーネスの `apps/worker/src/index.ts` に3箇所だけ追記

```typescript
// (1) import 群に追加
import { habitRoutes, sendWeeklyHabitDigest } from './habit-routes.js';

// (2) 他の app.route(...) の並びに追加
app.route('/', habitRoutes);

// (3) 既存の scheduled() の cron "0 9 * * *" 分岐に追加（sendRemindersと同じ場所）
//     ctx.waitUntil(sendWeeklyHabitDigest(env));
//     ※毎日呼んでよい。関数側で「JST月曜のみ送信」を判定する。cronの追加は不要
```

`habit-routes.js` は `apps/worker/src/` にコピーする（`line-utils.js` は予約システムで導入済み）。

### 4. LIFF HTML を KV に格納

```bash
wrangler kv key put --binding=STATIC_KV "liff/habit.html" --path=line-habit/liff/habit.html --remote
```

### 5. デプロイ

```bash
cd apps\worker
pnpm run deploy
```

（`npx wrangler deploy` 単体は使わない。予約システムREADME参照）

### 6. 会員への配布

LIFF URL（`https://liff.line.me/<HABIT_LIFF_ID>`）をLINEリッチメニューまたは
メッセージで会員に案内する。

## 動作確認チェックリスト

- [ ] `GET /api/liff/habit/summary` が `{today, logs}` を返す（LINEアプリ内で）
- [ ] 記録→「✅記録しました」→7日表示と統計が更新される
- [ ] 同じ日を保存し直すと上書きされる（重複行にならない）
- [ ] 「昨日」タブで昨日の分を記録できる／一昨日以前は記録できない（API側で400）
- [ ] 月曜18時のダイジェストがスタッフLINEに届く（先週分の集計）
- [ ] ダイジェスト末尾に「⚠️ 先週は記録なし（声かけ候補）」が出る（該当者がいる週のみ）
- [ ] 離脱アラートが「対象者がいる日」だけスタッフに届き、翌日は再送されない
- [ ] 連続日数が節目（3/7/14/30日）に達した保存でお祝い表示が出る
- [ ] 昨日が未記録のとき「昨日」タブに橙色のドットが出て、記録すると消える
- [ ] フッター文言が状態で変わる（継続中=日数表示／途切れ後=おかえりなさい）

## API仕様（メモ）

| メソッド/パス | 内容 |
|---|---|
| `GET /liff/habit` | 記録ページ配信（KVから。HABIT_LIFF_ID注入） |
| `GET /api/liff/habit/summary` | 自分の直近28日の記録＋JST今日の日付 |
| `POST /api/liff/habit/log` | `{log_date, moved, ate_well, note}` を保存（今日/昨日のみ、UPSERT）。全部空は `empty_log` 400 |
