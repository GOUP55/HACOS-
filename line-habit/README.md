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
- **表示**: 連続記録日数・今月の記録日数・今月動いた日数・直近7日のドット
- **週間ダイジェスト**: 毎週月曜18時(JST)に先週月〜日の集計＋メモをスタッフLINEへ。
  記録が1件もない週は送らない
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

## API仕様（メモ）

| メソッド/パス | 内容 |
|---|---|
| `GET /liff/habit` | 記録ページ配信（KVから。HABIT_LIFF_ID注入） |
| `GET /api/liff/habit/summary` | 自分の直近28日の記録＋JST今日の日付 |
| `POST /api/liff/habit/log` | `{log_date, moved, ate_well, note}` を保存（今日/昨日のみ、UPSERT）。全部空は `empty_log` 400 |
