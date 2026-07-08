---
description: LPをブラウザで開いてモバイル表示のスクリーンショットを撮り、見せる
argument-hint: [対象ファイル。省略時は index.html]
---

LPの表示確認をしてください。

対象: $ARGUMENTS（指定がなければ index.html。premium など省略形でも判断する）

手順:
1. Playwright（Chromium: /opt/pw-browsers/chromium）で対象HTMLをローカルで開く
2. モバイル幅390pxでページ全体のフルページスクリーンショットを撮る（保存先はスクラッチディレクトリ）
3. 必要ならPC幅1280pxも撮る
4. スクリーンショットを私に送って見せる（SendUserFile）
5. コンソールエラー・画像の読み込み失敗・明らかな崩れがあれば箇条書きで添える

注意: 表示確認だけで、ファイルの修正はしない。崩れがあれば「/lp-fix で直せます」と一言添える。
