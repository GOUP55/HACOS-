"""hacos-hmc-lp.html → index.html を生成する。

【方針変更（構造改善③：base64脱却）】
以前は画像を base64 で index.html に埋め込んでいたため、HTMLが約12MBに肥大し、
モバイル初速が遅く、ブラウザキャッシュも効かなかった。

現在は画像を base64 化せず、`images/xxx.jpg` のパス参照のまま残す。
→ index.html は約55KBに激減。画像は images/ ごと Netlify にデプロイされ、
   個別にキャッシュ＆並列ロードされる（loading="lazy" で遅延読み込みも有効）。

Netlify の公開ファイルは従来どおり index.html。images/ フォルダも一緒に
push すればパス参照で表示される。
"""
import re
import os

SRC = 'hacos-hmc-lp.html'
DST = 'index.html'

html = open(SRC, encoding='utf-8').read()

# 参照されている素材の存在チェック（欠損を早期に警告）
refs = sorted(set(re.findall(r"(?:url\(['\"]?|src=['\"])images/([^'\")]+)", html)))
missing = [fn for fn in refs if not os.path.exists(f'images/{fn}')]
for fn in refs:
    mark = '✗ NOT FOUND' if fn in missing else '✓'
    print(f'  {mark}  images/{fn}')

# 画像はパス参照のまま。index.html は実質コピー（パスは images/ を維持）。
open(DST, 'w', encoding='utf-8').write(html)

kb = os.path.getsize(DST) / 1024
print(f'\n✅ {DST} を生成しました（{kb:.0f} KB）。')
print('   images/ フォルダごと git push して Netlify にデプロイしてください。')
if missing:
    print(f'\n⚠️  {len(missing)} 件の画像が見つかりません: {missing}')
