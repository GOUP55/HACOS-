import base64, re, os

html = open('hacos-hmc-lp.html', encoding='utf-8').read()
refs = set(re.findall(r"(?:url\(['\"]?|src=['\"])images/([^'\")]+)", html))
mime = {'webp':'image/webp','jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png'}
skip_ext = {'mp4','mov','webm','avi'}

for fn in refs:
    path = f'images/{fn}'
    if not os.path.exists(path):
        print(f'[SKIP] {fn} not found')
        continue
    ext = fn.rsplit('.',1)[-1].lower()
    if ext in skip_ext:
        print(f'[SKIP] {fn} (video – kept as path)')
        continue
    b64 = base64.b64encode(open(path,'rb').read()).decode()
    html = html.replace(f"images/{fn}", f"data:{mime[ext]};base64,{b64}")
    print(f'[OK]   {fn}')

open('index.html','w', encoding='utf-8').write(html)
print('\n✅ index.html を生成しました。Netlifyにアップしてください。')
