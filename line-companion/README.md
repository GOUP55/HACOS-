# HACOSコンパニオン（S級① Phase 1・β版）

LINEで会員が食事や体調をつぶやくと、HACOSのトーンで寄り添う返事を返すAI。
構想: `S_CLASS_PROJECTS.md` ① ／ 人格の正本: `drafts/companion-persona.md` ／ デプロイ手順: `DEPLOY_COMPANION.md`

## 仕組み（データの流れ）

```
会員のLINEメッセージ
  → LINE Harness Worker（webhook）
    → handleCompanionEvent()
        ├ β会員でない → 何もしない（既存の自動応答へ）
        ├ 緊急キーワード → AIを通さず固定文で返信＋スタッフLINEへ即時通知
        └ 通常 → 直近の会話履歴つきでClaude API（Haiku）→ 返信
                   返答が「人が見るべき」ならスタッフ通知
  すべての往復を D1（companion_logs）に記録
  毎日の既存cron（JST18時）に相乗りして日次レポートをスタッフLINEへ
```

## ファイル

| ファイル | 役割 |
|---|---|
| `src/companion-routes.js` | 本体。webhookイベント処理・安全二層・返信・ログ・日次レポート |
| `src/companion-prompt.js` | システムプロンプト（**自動生成・直接編集禁止**） |
| `build_companion_prompt.py` | 人格の正本（md）→ プロンプト（js）の生成スクリプト |
| `migrations/2026-07-08-companion-tables.sql` | D1テーブル（companion_logs）。1回だけ実行 |
| `tests/companion.test.js` | 自動テスト14件（ネットワーク不要。`node companion.test.js`） |

## 人格を直したいとき（コードは触らない）

1. `drafts/companion-persona.md` を編集（GOの赤入れもここ）
2. `python3 line-companion/build_companion_prompt.py` を実行
3. 生成された `companion-prompt.js` を本番に反映（DEPLOY_COMPANION.md §4）

## 安全設計（companion-persona.md §2 の実装）

- **安全層1**: 希死念慮・胸痛/しびれ・服薬/持病・妊娠/産後・摂食不安/嘔吐・絶食・けが・深刻な落ち込み → **AIを通さず**固定文＋スタッフ即時通知（稼働時間の方針に関係なく即時）
- **安全層2**: AI返答自身のescalateフラグ → スタッフ通知
- 誤検知は「人間に繋がる」側に倒れる設計（安全側の失敗）
- 外部相談窓口の電話番号は環境変数 `CRISIS_HOTLINE_TEXT`（**GOが公式サイトで確認してから設定**。未設定なら文言ごと出ない）
- API障害時は技術エラーを会員に見せず、固定文＋スタッフ通知

## コスト目安

システムプロンプト約9,400字（キャッシュ指定済み）。Haiku級で1往復あたり概ね1円前後、β5名の想定利用なら月数百円規模（実測はAnthropicコンソールのUsageで確認）。
