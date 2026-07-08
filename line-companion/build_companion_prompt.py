#!/usr/bin/env python3
"""companion-persona.md（人格の正本）→ companion-prompt.js（システムプロンプト）を生成する。

使い方: リポジトリのルートで  python3 line-companion/build_companion_prompt.py
GOの赤入れで drafts/companion-persona.md を直したら、このスクリプトを再実行するだけで
コード側に反映される（コードは書き換えない）。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "drafts" / "companion-persona.md"
DST = Path(__file__).resolve().parent / "src" / "companion-prompt.js"

FOOTER = """
## 出力形式（厳守）
必ず次のJSONだけを出力する。前後に文章を付けない:
{"reply": "会員へのLINE返信文（§1の型・2〜4文・絵文字は🌿を1個まで）", "escalate": true/false, "topic": "食事報告/弱音/質問/復帰/その他 のいずれか"}
- escalate は「人間（GO）が見るべき相談」と判断したら true（解約相談・強い不安・§2に近い曖昧なケースなど。迷ったらtrue）
- §2の即転送リストに該当しそうな内容は、助言せず「GOに共有しますね」と返し、必ず escalate: true
- §3にない価格・日付・実績数値を絶対に作らない。知らないことは「スタッフに確認しますね」と返す
- 【】で囲まれた表記は例文中の未確定プレースホルダ。**出力に【】を絶対に含めない**
- 相談窓口の電話番号は、この指示文に明記されていない限り**一切口にしない**（うろ覚えの番号を作らない）
"""

def main():
    md = SRC.read_text(encoding="utf-8")

    # §1〜§8（人格・安全・事実・問答例）を丸ごと採用。§9以降（未決事項・手順）は運用メモなので除外
    m = re.search(r"(## §1 .*?)\n---\n\n## §9", md, re.S)
    if not m:
        raise SystemExit("ERROR: §1〜§8の抽出に失敗。companion-persona.md の見出し構成を確認してください。")
    body = m.group(1)

    prompt = (
        "あなたは香川県観音寺市のフィットネス×食×コミュニティ「HACOS」のLINEサポーターAI。\n"
        "以下の「人格の正本」に厳密に従って、会員のメッセージに返信する。\n\n"
        + body.strip()
        + "\n"
        + FOOTER.strip()
        + "\n"
    )

    # JSのテンプレートリテラル用エスケープ
    esc = prompt.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    js = (
        "// このファイルは自動生成。直接編集しない。\n"
        "// 正本: drafts/companion-persona.md ／ 生成: python3 line-companion/build_companion_prompt.py\n"
        f"export const COMPANION_SYSTEM_PROMPT = `{esc}`;\n"
    )
    DST.write_text(js, encoding="utf-8")
    qa_count = len(re.findall(r"^\*\*Q\d+", body, re.M))
    print(f"OK: {DST.relative_to(ROOT)} を生成（問答{qa_count}本・{len(prompt)}文字）")

if __name__ == "__main__":
    main()
