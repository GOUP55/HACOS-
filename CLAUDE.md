# HACOS × HMC プロジェクト

「継続できる運動と食の習慣化」を掲げるフィットネス×食事×コミュニティのLPと予約システム。
非エンジニアのオーナーが Claude Code チームで運営する。**速さより品質**。

## 構成（読む前にここで判断する）
- `hacos-hmc-lp.html` … メインLPのソース。**`index.html` は直接編集禁止**（`python3 build_index.py` で生成）
- `premium.html` … プレミアムプランLP（第1期生・定員3名・¥300,000・締切7/31）
- `line-reservation/` … LINE予約システム（liff / src / schema.sql）
- `images/` … 画像40点（web用は長辺1200px・JPEG q82、base64化しない）
- `*.gs` … Google Apps Script（LINE通知・Slack通知・予定同期）
- 企画・運用ドキュメントはルートの各 `*.md`（必要なものだけ読む）

## ブランド
- 配色: `--cream:#F5F0E8` `--forest:#3D5A3E` `--amber:#C8833A` `--rust:#B85C38` `--dark:#1C1C1A`
- フォント: Cormorant Garamond / Noto Serif JP / DM Sans
- トーン: 温かく誠実、押し売りしない。「動く×食べる×つながる」「ひとりじゃない」
- リンク: LINE `https://lin.ee/TsRy6I9` / Instagram `hmc.day`

## チーム運用（AI_COST_GUIDE.md 参照）
- 上位モデル（メインセッション）＝**設計・方針決め・難しい判断だけ**
- 実装・文章量産 → `hacos-frontend` / `hacos-copywriter`（Sonnet）
- 定型処理（整形・抽出・一括チェック）→ `hacos-ops`（Haiku）
- 品質ループ: 制作 → build → `hacos-qa` レビュー → 高/中ゼロまで修正 → ユーザー承認後に公開（TEAM_WORKFLOW.md）

## 厳守
- 実績数値の捏造・誇大表現をしない。「効果には個人差があります」を実績言及に付ける
- モバイルファースト（基準幅390px）
- main への直接pushはしない（ユーザー承認後）
