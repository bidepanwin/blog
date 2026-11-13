# -*- coding: utf-8 -*-
"""从 moments 里抽出「原文 → 成文」对照，存成风格学习语料。"""
import glob
import io
import os
import re

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src/content/moments")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "drafts/_originals/moments-pairs.md")

rows = []
for path in sorted(glob.glob(os.path.join(SRC, "*.md"))):
    text = io.open(path, encoding="utf-8").read()
    if "**原文**" not in text:
        continue

    # 取出 > **原文** 后面的引用块
    quote = re.search(r"> \*\*原文\*\*\s*\n((?:>.*\n)+)", text)
    if not quote:
        continue
    raw = "\n".join(
        line[2:].strip() if line.startswith("> ") else line.lstrip(">").strip()
        for line in quote.group(1).strip().split("\n")
    ).strip()

    # 引用块之后是 `---` 分隔，分隔线之后才是成文
    after = text[quote.end():]
    body = re.split(r"\n-{3,}\n", after)[-1].strip()

    rows.append((os.path.basename(path), raw, body))

lines = [
    "# 微信原稿 → 成文 对照语料",
    "",
    "> 自动从 `src/content/moments/` 抽取。原稿是他给我的原话，成文是润色后的版本。",
    "> 用途：校准「改写力度」——他接受什么、不接受什么，看这一对对就清楚。",
    f"> 共 {len(rows)} 组，生成于 2026-10-31。",
    "",
]

for name, raw, body in rows:
    lines += [
        f"## {name}",
        "",
        "**原文**",
        "",
        "```text",
        raw,
        "```",
        "",
        "**成文**",
        "",
        "```text",
        body,
        "```",
        "",
    ]

io.open(OUT, "w", encoding="utf-8").write("\n".join(lines))
print(f"已写出 {len(rows)} 组对照 -> {OUT}")
