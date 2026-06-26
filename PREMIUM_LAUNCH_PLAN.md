# PREMIUM 第1期生 ローンチ「集客 × 計測」プラン

> 対象: HACOS 3ヶ月プレミアムメソッド 第1期生
> 募集締切: **2026-07-15** ／ 定員: **3名** ／ スタート: 2026年7月
> プレミアムLP: https://hmclife.netlify.app/premium.html ／ メインLP: https://hmclife.netlify.app/
> 主CTA: 無料カウンセリング予約（LINE `https://lin.ee/TsRy6I9`）
> 作成日: 2026-06-26 ／ 担当: hacos-growth
>
> **※本プランの数値はすべて「仮の目安」です（実績データなし）。実数が出たら差し替えてください。**
> **※計測タグ（GA4 / Meta Pixel）は両LPの `<head>` にテンプレ設置済み・ID未設定。本プランでは「後入れ手順」のみ記載し、実装はしません。**

---

## 0. 前提（事実の確認）

- **二段階導線**: 無料カウンセリング(30分・Zoom可)をLINEで予約 → クロージング → 成約。
- **マイクロCV = 「カウンセリング予約」**。逆算で予約数の最大化がローンチKPIの中心。
- 集客主軸: LINE公式 ・ Instagram(@hmc.day)。
- プレミアムLPのCTAはすべてLINE。メインLPには「プレミアムLPへの遷移」CTAが複数ある（後述）。
- 計測タグは現状コメントアウト。ID（GA4測定ID / Meta Pixel ID）が来てから有効化する運用。

---

## 1. ファネルと KPI（すべて仮の目安）

逆算: **成約3名**から逆算したファネル。CVRはBtoC高単価相談の一般的な目安レンジで「仮置き」。実数で必ず更新。

| 段階 | 指標 | 仮の目標値 | 仮CVR（前段比） | 備考 |
|---|---|---|---|---|
| ① 認知・表示 | LINE配信到達 + IGリーチ + LP表示 | 配信到達 約300〜500 / IGリーチ 約2,000〜4,000（仮） | — | 既存LINE友だち数・IGフォロワー数で要調整 |
| ② プレミアムLP遷移 | premium.html セッション | **150〜250 セッション**（仮） | LINE/IGから 約5〜10% | メインLP経由＋直リンク合算 |
| ③ カウンセリング予約 | LINE「カウンセリング希望」着信 = micro CV | **15〜25 件**（仮） | LP遷移の 約10%（仮） | 本ローンチの最重要KPI |
| ④ カウンセリング実施 | Zoom/対面 実施数 | **12〜20 件**（仮） | 予約の 約80%（no-show 20%想定） | リマインドで改善可 |
| ⑤ 成約 | プレミアム申込 | **3名（定員）** | 実施の 約15〜25%（仮） | 定員到達で早期締切も可 |

### 北極星指標とサブKPI
- **North Star: ③カウンセリング予約数**（締切までに最低 **15件**を仮目標）。
- サブKPI: LP遷移率（②/①）、予約率（③/②）、no-show率（1−④/③）。
- **定員ロジック**: 成約率を仮25%とすると、3名確保には実施12件 → 予約15件が最低ライン。安全率を見て**予約20件**を運用目標に置く。

---

## 2. GA4 イベント設計表

`recommended events` と `custom events` を併用。**コンバージョンに指定するのは `generate_lead`**（カウンセリング予約クリック）。遷移系はマイクロ指標として計測のみ。

| イベント名 | 種別 | 発火条件 | 対象CTA（ファイル / 行の目安 / ラベル） | パラメータ例 |
|---|---|---|---|---|
| `page_view` | 自動 | ページ表示（GA4標準） | 全ページ | `page_location` |
| `cta_lp_to_premium` | custom | メインLP→プレミアムLPへの遷移クリック | **hacos-hmc-lp.html** 行1046「プレミアムメソッド →」(voices-cta)、行1153「プレミアムの全貌を見る →」(method-cta) | `cta_id`, `link_url=premium.html`, `location` |
| `view_premium_lp` | custom（任意） | premium.html 表示（page_viewで代替可） | premium.html 全体 | `page_location` |
| `cta_counseling_line` | custom | 「LINEで無料カウンセリング予約」クリック | **premium.html** 行293（Hero下）、行554（最終CTA）、行570（sticky）／ **hacos-hmc-lp.html** 行1156（method secondary） | `cta_id`, `location=hero/final/sticky/method`, `link_url=lin.ee/TsRy6I9` |
| `generate_lead` ★CV | recommended（**CV指定**） | カウンセリング予約意図のLINEクリック（= `cta_counseling_line` と同時 or 集約） | 上記カウンセリング系CTA全て | `lead_type=counseling`, `value`(任意), `currency=JPY` |
| `cta_experience_form` | custom | 無料体験フォーム（運動体験）クリック | **hacos-hmc-lp.html** 行545/566/954/992/1193（forms.gle） | `cta_id`, `link_url=forms.gle/...` |
| `cta_line_general` | custom | お弁当注文・一般相談などプレミアム以外のLINEクリック | hacos-hmc-lp.html 行706/786/816/846/895/1114/1197 等 | `cta_id`, `intent=bento/consult` |
| `scroll_premium_50/90` | 拡張計測 | premium.html を 50% / 90% スクロール | premium.html | GA4拡張計測の `scroll` を活用 |
| `faq_open` | custom（任意） | premium.html FAQ開閉 | premium.html FAQ（行574〜の `.faq-q`） | `question_id` |

### CV / オーディエンス設定（GA4管理画面）
- **コンバージョン**: `generate_lead` を「主要イベント」に指定（GA4の「主要なイベントとしてマークを付ける」）。
- **オーディエンス（広告・分析用）**:
  - 「LP遷移したが予約せず」= `cta_lp_to_premium` 有 ∧ `generate_lead` 無 → リマケ候補。
  - 「予約直前離脱」= premium.html 90%スクロール ∧ `generate_lead` 無。
- **UTM**: 全配信リンクに `utm_source/medium/campaign` を付与（§4にパラメータ規約）。

### 実装方式メモ（IDが来てから）
- LINE / フォームは `target="_blank"` の外部遷移リンク → クリック計測は `addEventListener('click', ...)` で `gtag('event', ...)` を発火。
- 共通化推奨: 各CTAに `data-ga-event="cta_counseling_line"` `data-ga-loc="hero"` を付け、1つの委譲リスナーでまとめて送信（CTAごとに個別コードを書かない）。**実装は別タスク**。

---

## 3. Meta Pixel イベント設計 + 有効化手順

### 3-1. イベント設計

| Pixelイベント | 発火条件 | 対象 | 備考 |
|---|---|---|---|
| `PageView` | 全ページ表示 | 両LP（テンプレ内 `fbq('track','PageView')` で既定） | 基本タグで自動 |
| `ViewContent` | premium.html 表示 | premium.html | `content_name='premium_lp'` |
| `Lead` ★主CV | カウンセリング予約のLINEクリック | premium.html 行293/554/570、hacos-hmc-lp.html 行1156 | GA4 `generate_lead` と同一トリガー |
| `Lead`(別ラベル) or `Contact` | 一般LINE相談クリック（任意で分離） | hacos-hmc-lp.html LINE系 | プレミアムLeadと区別したい場合 |
| `CompleteRegistration`（任意） | 成約時（手動 or 別途） | クロージング後 | 自動取得困難。手動Conversions APIや手入力で代替可 |

- **広告最適化**: キャンペーンの最適化イベントは `Lead` に設定。`PageView`→`ViewContent`→`Lead` のファネルでカスタムオーディエンス／類似オーディエンスを作成。

### 3-2. Meta Pixel 有効化の手順（テンプレの該当箇所）

両LP `<head>` 内、コメントブロックに同じテンプレが入っています。

- **premium.html**: 行20〜38 のコメントブロック。Pixel本体は **行31〜37**、ID差込は **行36 `fbq('init','0000000000000000')`**。
- **hacos-hmc-lp.html**: 行（同等ブロック）。Pixel本体は **行61〜66**、ID差込は **行66 `fbq('init','0000000000000000')`**。

手順:
1. コメント開始 `<!-- ═══ 計測タグ...` と終了 `═══ ここまで計測タグ ═══ -->` を外し、スクリプトを有効化。
2. `0000000000000000`（16桁）を **実Pixel IDに置換**（両ファイル）。
3. `fbq('track','PageView')` は既定で入っているのでPageViewは即計測。
4. `ViewContent` / `Lead` の追加発火は別途CTAクリックに紐づけて実装（GA4と同一トリガー、§2実装メモ準拠）。
5. Meta「イベントテストツール」でPageView→Leadの発火を確認。

> 注意（ルール準拠）: **ダミーIDのまま `fbq` を有効化しない**。ID未確定の間はコメントのまま据え置く。

---

## 4. 配信カレンダー（2026-06-26 〜 07-15）

役割分担: 文面は copywriter が作成（本表は「いつ・どのチャネル・狙い・遷移先」を定義）。
**UTM規約**: `utm_source`(line/instagram) / `utm_medium`(broadcast/feed/story/bio) / `utm_campaign=premium_2026q3` / `utm_content`(配信回ラベル例 d0626_teaser)。

| 日付 | チャネル | コンテンツ役割 | 遷移先 | 狙う指標 |
|---|---|---|---|---|
| 6/26(金) | IG フィード | ローンチ予告・第1期生コンセプト提示（定員3名・期間限定の世界観） | プロフィールリンク→premium.html | 認知/保存 |
| 6/27(土) | LINE 一斉 | 「第1期生 募集開始」告知＋無料カウンセリング案内 | premium.html / LINE予約 | LP遷移・予約初動 |
| 6/28(日) | IG ストーリーズ | 当日朝活の様子＋プレミアム導線（リンクスタンプ） | premium.html | リーチ→遷移 |
| 6/30(火) | IG フィード | 「3ヶ月で何が変わるか」ビフォー思考・メソッド解説（実績は捏造しない／一般論で） | premium.html | 検討促進 |
| 7/2(木) | LINE 一斉 | カウンセリングの中身・"勧誘なし/話すだけOK"で心理ハードル下げ | LINE予約 | 予約 |
| 7/4(土) | IG ストーリーズ | 質問箱/FAQ回収→翌週フィードのネタに | DM/premium.html | エンゲージ |
| 7/5(日) | IG フィード | 朝活レポ＋「残席」言及（実数ベースのみ） | premium.html | 遷移・限定性 |
| 7/8(火) | LINE 一斉 | 中間リマインド「締切まで1週間」＋カウンセリング枠の空き提示 | LINE予約 | 予約 |
| 7/10(木) | IG フィード | よくある不安への回答（料金/時間/続けられるか） | premium.html | 不安解消 |
| 7/11(金) | IG ストーリーズ | カウントダウン開始（締切4日前） | premium.html | 緊急性 |
| 7/12(土) | LINE 一斉 | 「締切3日前・残席◯」※残席は実数のみ | LINE予約 | ラストプッシュ |
| 7/13(日) | IG ストーリーズ | 朝活レポ＋カウントダウン（2日前） | premium.html | 緊急性 |
| 7/14(月) | LINE 一斉 ＋ IG ストーリーズ | 「明日締切・最終案内」 | LINE予約 | 駆け込み予約 |
| 7/15(火) | LINE 一斉（午前/夕方2回可） ＋ IG ストーリーズ | 「本日締切」最終リマインド | LINE予約 | 締切当日CV |

運用メモ:
- LINE一斉は**配信疲れ回避のため週2〜3回上限**を目安（仮）。反応で調整。
- 締切週（7/8以降）はリマインド密度を上げる。**「残席◯名」は実数のみ**記載（捏造しない）。
- 各配信のUTM `utm_content` をGA4で突き合わせ、効いた配信を特定。

---

## 5. CRO 改善 優先度トップ5

| # | 施策 | 狙う指標 | 根拠 | 実装難易度 | 優先度 |
|---|---|---|---|---|---|
| 1 | **カウンセリング予約クリックの計測有効化（GA4 `generate_lead`/Pixel `Lead`）** | 予約数の可視化・配信ROI | 計測がなければ全施策の良否が判断不能。ID後入れの土台 | 低（ID後5分） | ★★★★★ |
| 2 | **メインLP→premium.html 導線の強化と計測** | LP遷移率(②/①) | 現状プレミアム遷移CTAは行1046/1153の2箇所中心で埋もれがち。ファーストビュー近くにも1つ＋`cta_lp_to_premium`計測 | 中 | ★★★★★ |
| 3 | **カウンセリングCTAのコピー/サブテキスト最適化（"勧誘なし・話すだけOK・Zoom可"を全CTA直下に統一）** | 予約率(③/②) | 高単価相談の最大の障壁は「売り込まれる不安」。premium.html行294/555は既に良文。全CTAに横展開＋A/Bテスト | 低 | ★★★★☆ |
| 4 | **限定性の動的提示（締切カウントダウン＋"残席◯"）** | 予約率・締切前CV | 期間限定・定員3名は強い動機。静的記述（行567等）を締切連動表示に。残席は実数で | 中 | ★★★★☆ |
| 5 | **no-show削減: LINE予約後の自動リマインド/前日確認フロー** | カウンセリング実施率(④/③) | ファネル④で20%離脱想定。締切前は予約枠が貴重。LINE定型文/手動リマインドで回収 | 中 | ★★★☆☆ |

補足候補（次点）: ②の一環でsticky CTA文言の締切連動化、premium.htmlの社会的証明（実体験ベースのみ）の追加、価格の月額/日額換算表示。

---

## 6. 計測「後入れ」チェックリスト（ID受領後 約5分で有効化）

> 前提: GA4測定ID（`G-XXXXXXXXXX`）と Meta Pixel ID（16桁）を受領済み。ルール: ダミーIDでは発火させない。

```
□ 1. premium.html の <head> 計測コメントブロック（行20〜38）を解除
       - コメント開始/終了マーカーを削除してスクリプトを有効化
□ 2. hacos-hmc-lp.html の同等コメントブロックを解除
□ 3. GA4測定ID 置換（両ファイル）
       - `G-XXXXXXXXXX` を実IDに（premium.html 行23/28、メインLP 行53/58）
□ 4. Meta Pixel ID 置換（両ファイル）
       - `0000000000000000` を実IDに（premium.html 行36、メインLP 行66）
□ 5. ビルド: メインLPは `python3 build_index.py` で index.html 再生成
       （premium.html はそのままデプロイ対象か要確認）
□ 6. デプロイ: git add -A && commit && push → Netlify自動反映
□ 7. 検証:
       - GA4「リアルタイム」で自分のアクセスが page_view 計上されるか
       - Meta「イベントテストツール」で PageView 発火確認
□ 8. （別タスク）CTAクリックイベント（generate_lead / Lead 等）の発火実装
       - data属性 + 委譲リスナー方式。実装後にGA4 DebugView / Pixel Test で確認
□ 9. GA4で `generate_lead` を「主要イベント（CV）」に指定
□ 10. UTM付きリンクで配信開始 → GA4トラフィック獲得レポートで配信別に確認
```

**所要時間目安**: 手順1〜7（基本タグ有効化）で約5分。手順8（クリックイベント実装）は別途30分〜想定。

---

### 参照: 対象CTAの所在（実装時の地図）

**premium.html**（CTAは全てLINEカウンセリング）
- 行293: Hero下 「LINEで無料カウンセリングを予約 →」
- 行554: 最終CTA 「LINEで無料カウンセリングを予約 →」
- 行570: sticky CTA 「LINEで予約 →」

**hacos-hmc-lp.html**
- 行1046 / 1153: → premium.html 遷移（`cta_lp_to_premium`）
- 行1156: プレミアム文脈のLINEカウンセリング（`cta_counseling_line`）
- 行545/566/954/992/1193: 無料体験フォーム（forms.gle、`cta_experience_form`）
- 行706/786/816/846/895/1114/1197: 一般LINE（お弁当/相談、`cta_line_general`）
