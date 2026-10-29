#!/usr/bin/env python3
"""本番Worker（line-harness）の文言だけを差し替える。

PCが壊れていてWorkerを再ビルドできないため、本番のビルド済みコードを
Cloudflare APIから取り出し、決められた文字列だけを置き換えて戻す。
バインディングや設定は /content エンドポイントで上書きしないので変わらない。

使い方:
  python3 patch_worker_text.py split  <download.bin> <content-type> <outdir>
  python3 patch_worker_text.py patch  <outdir> <patch.json>
  python3 patch_worker_text.py verify <outdir> <patch.json>

patch.json: {"replacements": [{"old": "...", "new": "..."}, ...]}
old が1件も見つからない場合は失敗して何も書き換えない（すでに適用済みの new がある場合は飛ばす）。
"""
import json
import os
import sys
from email.parser import BytesParser
from email.policy import default


def split(src, content_type, outdir):
    raw = open(src, "rb").read()
    msg = BytesParser(policy=default).parsebytes(
        b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + raw
    )
    if not msg.is_multipart():
        sys.exit("本番コードが multipart ではありません。想定外の形式なので中止します。")
    manifest = []
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename() or name
        body = part.get_payload(decode=True)
        if not filename or body is None:
            continue
        path = os.path.join(outdir, "modules", filename)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        ctype = part.get("Content-Type")
        if ctype:
            ctype = part.get_content_type()
        elif filename.endswith((".js", ".mjs")):
            ctype = "application/javascript+module"
        elif filename.endswith(".wasm"):
            ctype = "application/wasm"
        else:
            ctype = "text/plain"
        manifest.append({"name": filename, "type": ctype})
    if not manifest:
        sys.exit("モジュールが取り出せませんでした。中止します。")
    with open(os.path.join(outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"{len(manifest)} モジュールを取り出しました:")
    for m in manifest:
        print(" -", m["name"], m["type"])


def _load(outdir, patch_json):
    manifest = json.load(open(os.path.join(outdir, "manifest.json")))
    reps = json.load(open(patch_json, encoding="utf-8"))["replacements"]
    texts = {}
    for m in manifest:
        if "javascript" in m["type"]:
            p = os.path.join(outdir, "modules", m["name"])
            texts[m["name"]] = open(p, encoding="utf-8", newline="").read()
    return manifest, reps, texts


def patch(outdir, patch_json):
    manifest, reps, texts = _load(outdir, patch_json)
    changed = 0
    for r in reps:
        old, new = r["old"], r["new"]
        n_old = sum(t.count(old) for t in texts.values())
        n_new = sum(t.count(new) for t in texts.values())
        if n_old == 0 and n_new > 0:
            print(f"適用済み: {new}")
            continue
        if n_old == 0:
            sys.exit(f"本番コードに見つかりません（中止）: {old}")
        for k in texts:
            texts[k] = texts[k].replace(old, new)
        changed += n_old
        print(f"{n_old}件 置換: {old} → {new}")
    for k, t in texts.items():
        with open(os.path.join(outdir, "modules", k), "w", encoding="utf-8", newline="") as f:
            f.write(t)
    with open(os.path.join(outdir, "changed"), "w") as f:
        f.write(str(changed))
    print(f"合計 {changed} 件を置き換えました。")


def verify(outdir, patch_json):
    _, reps, texts = _load(outdir, patch_json)
    ok = True
    for r in reps:
        n_old = sum(t.count(r["old"]) for t in texts.values())
        n_new = sum(t.count(r["new"]) for t in texts.values())
        state = "OK" if n_old == 0 and n_new > 0 else "NG"
        ok &= state == "OK"
        print(f"[{state}] 新:{n_new} 旧:{n_old}  {r['new']}")
    if not ok:
        sys.exit("本番に反映されていない文言があります。")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "split":
        split(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "patch":
        patch(sys.argv[2], sys.argv[3])
    elif cmd == "verify":
        verify(sys.argv[2], sys.argv[3])
    else:
        sys.exit("split / patch / verify のいずれかを指定してください")
