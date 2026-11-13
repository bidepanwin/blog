#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 前沿日报 / 技术与思路周报 —— 云端编排入口。

流程与原邮箱版一致：prompt（联网检索）→ 严格 JSON → schema 校验 →
纯文本 + 暖陶 HTML → QQ 邮箱直推；额外把两份产物写进博客仓库：
  src/content/reports/<kind>-<date>.md   列表页用的 frontmatter + 纯文本正文
  src/data/reports/<kind>-<date>.html    详情页直接嵌入的面板 HTML

用法：
  python3 scripts/ai_report/run.py daily [--date YYYY-MM-DD] [--no-email]
  python3 scripts/ai_report/run.py weekly [--no-email]
环境变量：DEEPSEEK_API_KEY，SMTP_USER/SMTP_PASS/REPORT_TO_EMAIL（或 QQ_SMTP_*）。
"""
import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as rc  # noqa: E402
import daily as dl  # noqa: E402
import llm  # noqa: E402
import weekly as wk  # noqa: E402
import warm_theme as wt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPORTS_DIR = os.path.join(ROOT, "src", "content", "reports")
HTML_DIR = os.path.join(ROOT, "src", "data", "reports")
PROMPTS = os.path.join(HERE, "prompts")

log = rc.make_logger(os.environ.get(
    "REPORT_LOG", os.path.join(tempfile.gettempdir(), "ai_report.log")))

BJT = datetime.timezone(datetime.timedelta(hours=8))

CATCHUP_LOOKBACK = 7
CATCHUP_LIMIT = 3

BACKFILL_NOTICE = """

## 零、补发模式（优先级最高，与上文任何指令冲突时以本节为准）

本次是**补发**：报告的目标日期是 {target}，而实际生成时间是 {now}。
请把全文的「今天」一律理解为 {target}，并遵守：

1. **检索窗口锁定**：前四个维度只收录 {target} 当天及此前约 24 小时内
   首次发布或发生的动态（窗口 {prev} ~ {target}）。{target} 之后才发生的
   新闻一律不得收录——哪怕它更新、更重要、更容易检索到。
2. **检索手法**：查询词带上具体日期与月份（如「{target} AI」「{target} 发布」
   「{target} 融资」「{target} 政策」），优先使用站点的时间过滤；若某条动态
   只能找到 {target} 之后的报道，说明它不属于本窗口，弃用。
3. **赛事维度**：「报名截止 ≥ 今天」的基准改为 **≥ {target}**，即站在
   {target} 当天判断哪些赛事当时仍可报名。截止日期用赛事官方公布的原值，
   不得按今天的日期改写；若某赛事现已截止，仍按 {target} 当天的状态收录，
   并在 text 末尾注明「（该赛事现已截止）」。
4. **诚实优先**：无法确证发生在该窗口内的条目一律不收。补发报告条目偏少
   是可接受的，把 {target} 之后的新闻写进 {target} 的报告是不可接受的。
5. **格式硬约束不受稀疏影响**：briefs 必须恰好 3–5 条、sections 必须固定 5 个、
   deep_reads 1–2 条。窗口内动态稀少时，把次要但仍属该窗口的动态降级为
   briefs 条目补齐条数，或如实概括「该维度当日无重大更新」——但不得为了凑数
   引入窗口外的新闻。任何 section 的 items 可以为空数组 []。
"""


def now_bj():
    return datetime.datetime.now(BJT)


def _read_prompt(name):
    with open(os.path.join(PROMPTS, name), encoding="utf-8") as f:
        return f.read()


def _yaml_str(s):
    return json.dumps(str(s), ensure_ascii=False)


def _write_outputs(kind, date_str, title, description, text, inner_html):
    """写博客内容（.md）与面板 HTML；返回 (md_path, html_path)。"""
    os.makedirs(REPORTS_DIR, exist_ok=True)
    os.makedirs(HTML_DIR, exist_ok=True)
    slug = "%s-%s" % (kind, date_str)
    published = now_bj().strftime("%Y-%m-%dT%H:%M:%S+08:00")
    tags = ["Daily", "AI"] if kind == "daily" else ["Weekly", "AI"]
    md = (
        "---\n"
        "title: %s\n"
        "published: %s\n"
        "description: %s\n"
        "tags: %s\n"
        "category: %s\n"
        "lang: zh-CN\n"
        "---\n\n%s\n"
        % (_yaml_str(title), published, _yaml_str(description),
           json.dumps(tags, ensure_ascii=False), _yaml_str(kind.capitalize()),
           text)
    )
    md_path = os.path.join(REPORTS_DIR, slug + ".md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)
    html_path = os.path.join(HTML_DIR, slug + ".html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(inner_html)
    log("saved: %s / %s" % (md_path, html_path))
    return md_path, html_path


def _send_email(subject, text, html):
    host = rc.get_env("SMTP_HOST", "smtp.qq.com")
    user = rc.get_env("SMTP_USER") or rc.get_env("QQ_SMTP_USER")
    pw = rc.get_env("SMTP_PASS") or rc.get_env("QQ_SMTP_PASS")
    to = rc.get_env("REPORT_TO_EMAIL") or rc.get_env("QQ_SMTP_TO")
    port = rc.get_env("SMTP_PORT", "465")
    if not (user and pw and to):
        log("ERROR: SMTP 凭据缺失（SMTP_USER/SMTP_PASS/REPORT_TO_EMAIL）")
        return False
    try:
        rc.send_html_mail(host, int(port), user, pw, to, subject, text, html,
                          logger=log)
        return True
    except rc.ReportError as e:
        log("ERROR: 发信失败: %s" % e)
        return False


def run_daily(date_str=None, send_mail=True):
    log("=== daily report task start ==="
        + (" [backfill %s]" % date_str if date_str else ""))
    today = now_bj().strftime("%Y-%m-%d")
    ds = date_str or today
    backfill = today if (date_str and date_str != today) else None
    prompt = _read_prompt("daily.md").replace("{{TODAY}}", ds)
    if backfill:
        prev = (datetime.datetime.strptime(ds, "%Y-%m-%d").date()
                - datetime.timedelta(days=1)).isoformat()
        prompt += BACKFILL_NOTICE.format(target=ds, now=backfill, prev=prev)
    log("prompt length: %d chars, date=%s" % (len(prompt), ds))

    raw = llm.call(prompt, log=log)
    with open(os.path.join(tempfile.gettempdir(), "daily-raw-%s.txt" % ds),
              "w", encoding="utf-8") as f:
        f.write(raw)

    try:
        data = dl.parse_daily_json(raw, log=log)
    except dl.DailyReportError as e:
        log("ERROR: JSON 校验失败（%s）；原始输出见临时目录" % e)
        return 1

    text = dl.render_daily_text(data, ds, backfill=backfill)
    html = dl.render_daily_html(data, ds, backfill=backfill)
    inner = dl.render_daily_inner(data, ds, backfill=backfill)
    _write_outputs("daily", ds, "AI 前沿日报 · %s" % ds,
                   data["briefs"][0][:120], text, inner)

    if send_mail and not os.environ.get("REPORT_DRY_RUN"):
        subject = "AI前沿日报 - %s%s" % (ds, "（补发）" if backfill else "")
        ok = _send_email(subject, text, html)
        if not ok:
            log("=== daily report task end (email failed) ===")
            return 2
    log("=== daily report task end ===")
    return 0


def run_weekly(send_mail=True):
    log("=== weekly report task start ===")
    ds = now_bj().strftime("%Y-%m-%d")
    digests, missing = wk.collect_daily_reports(REPORTS_DIR, today=now_bj().date())
    if missing:
        log("WARN 缺失/损坏日报: %s" % ", ".join(missing))
    if not digests:
        log("WARN 本周无任何可用日报，完全依赖增量深研")

    prompt = wk.build_weekly_prompt(_read_prompt("weekly.md"), digests)
    log("prompt length: %d chars, digests: %d" % (len(prompt), len(digests)))

    raw = llm.call(prompt, log=log)
    with open(os.path.join(tempfile.gettempdir(), "weekly-raw-%s.txt" % ds),
              "w", encoding="utf-8") as f:
        f.write(raw)

    try:
        data = wk.parse_weekly_json(raw)
    except wk.WeeklyReportError as e:
        log("ERROR: JSON 校验失败（%s）；原始输出见临时目录" % e)
        return 1

    issue = wk.issue_number(REPORTS_DIR, ds)
    text = wk.render_weekly_text(data, issue, ds)
    html = wk.render_weekly_html(data, issue, ds)
    inner = wk.render_weekly_inner(data, issue, ds)
    _write_outputs("weekly", ds, "AI 技术与思路周报 No.%02d · %s" % (issue, ds),
                   data["headline"]["summary"][:120], text, inner)

    if send_mail and not os.environ.get("REPORT_DRY_RUN"):
        ok = _send_email("AI 技术与思路周报 - %s" % ds, text, html)
        if not ok:
            log("=== weekly report task end (email failed) ===")
            return 2
    log("=== weekly report task end (No.%02d) ===" % issue)
    return 0


def run_resend(kind="daily", date_str=None, send_mail=True):
    """把已归档的报告（.md 正文 + .html 面板）原样重发一封邮件。

    不重新生成、不改内容：读 src/content/reports/<kind>-<date>.md 的正文与
    src/data/reports/<kind>-<date>.html 的面板，用 warm_theme 套回邮件外壳。
    """
    ds = date_str or now_bj().strftime("%Y-%m-%d")
    md_path = os.path.join(REPORTS_DIR, "%s-%s.md" % (kind, ds))
    html_path = os.path.join(HTML_DIR, "%s-%s.html" % (kind, ds))
    if not (os.path.exists(md_path) and os.path.exists(html_path)):
        log("ERROR: 找不到可重发的归档 %s / %s" % (md_path, html_path))
        return 1
    with open(md_path, encoding="utf-8") as f:
        raw = f.read()
    text = raw.split("---", 2)[-1].lstrip("\n") if raw.startswith("---") else raw
    with open(html_path, encoding="utf-8") as f:
        inner = f.read()

    dot = ds.replace("-", ".")
    if kind == "weekly":
        import re
        m = re.search(r"No\.(\d+)", raw[:400])
        label = "No.%02d" % int(m.group(1)) if m else ""
        subject = "AI 技术与思路周报 - %s" % ds
        doc_title = ("AI 技术与思路周报 %s" % label).strip()
    else:
        subject = "AI前沿日报 - %s" % ds
        doc_title = "AI 前沿日报 %s" % dot

    log("resend: %s（不重新生成）" % md_path)
    if not send_mail or os.environ.get("REPORT_DRY_RUN"):
        log("DRY RUN: 跳过发信")
        return 0
    ok = _send_email(subject, text, wt.panel_page(doc_title, inner))
    return 0 if ok else 2


def cli(argv):
    kind = "daily"
    date_str = None
    send_mail = True
    catchup = False
    resend = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("daily", "weekly"):
            kind = a
        elif a == "--date":
            i += 1
            date_str = argv[i] if i < len(argv) else None
            try:
                datetime.datetime.strptime(date_str or "", "%Y-%m-%d")
            except ValueError:
                print("ERROR: --date 必须是 YYYY-MM-DD")
                return 2
        elif a == "--no-email":
            send_mail = False
        elif a == "--catchup":
            catchup = True
        elif a == "--resend":
            resend = True
        i += 1
    if resend:
        return run_resend(kind, date_str, send_mail=send_mail)
    if kind == "weekly":
        return run_weekly(send_mail=send_mail)
    if catchup and not date_str:
        gaps = select_catchup_dates(REPORTS_DIR, now_bj().date())
        log("catchup: 近 %d 天发现 %d 个缺口: %s"
            % (CATCHUP_LOOKBACK, len(gaps), ", ".join(gaps) or "无"))
        for ds in gaps:
            if os.path.exists(os.path.join(REPORTS_DIR, "daily-%s.md" % ds)):
                continue
            rc_day = run_daily(ds, send_mail=send_mail)
            log("catchup: %s -> rc=%d" % (ds, rc_day))
        return run_daily(None, send_mail=send_mail)
    return run_daily(date_str=date_str, send_mail=send_mail)


def select_catchup_dates(reports_dir, today, lookback=CATCHUP_LOOKBACK,
                         limit=CATCHUP_LIMIT):
    """近 lookback 天内缺失日报存档的日期（升序），最多 limit 个。"""
    existing = set()
    try:
        names = os.listdir(reports_dir)
    except OSError:
        return []
    for fn in names:
        if fn.startswith("daily-") and fn.endswith(".md"):
            existing.add(fn[len("daily-"):-3])
    gaps = []
    for i in range(1, lookback + 1):
        ds = (today - datetime.timedelta(days=i)).isoformat()
        if ds not in existing:
            gaps.append(ds)
    return sorted(gaps)[:limit]


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
