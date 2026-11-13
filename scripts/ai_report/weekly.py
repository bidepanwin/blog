#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 技术与思路周报：严格 JSON 契约 + 校验 + 纯文本/暖陶 HTML 渲染。

除「素材来自博客日报存档、生成端由 claude 换成 DeepSeek」外，schema 校验、
文案、HTML 结构逐字移植自原邮箱版 weekly-report/weekly_report.py。
"""
import datetime
import glob
import os

import common as rc
import warm_theme as wt

# kind -> （中文名, 标签底色, 标签字色）——周报专有分色
KIND_STYLE = {
    "concept": ("概念", "#3D2C23", "#E09A82"),
    "idea": ("想法", "#3A3226", "#D9B98A"),
    "path": ("实现路径", "#3D3934", "#B9B2A6"),
}


class WeeklyReportError(Exception):
    """周报链路可预期错误。"""


def strip_frontmatter(raw):
    """去掉博客 .md 的 YAML frontmatter，只留正文。"""
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) == 3:
            return parts[2].lstrip("\n")
    return raw


def collect_daily_reports(daily_dir, today=None, count=7, min_size=200):
    """聚合最近 count 天日报，返回 (digests, missing)。
    digests: [(date_str, content)] 倒序，仅含 >=min_size 且 UTF-8 可读文件；
    missing: 缺失日期，损坏标 (损坏)。"""
    d = today or datetime.date.today()
    digests, missing = [], []
    for i in range(count):
        day = d - datetime.timedelta(days=i)
        ds = day.strftime("%Y-%m-%d")
        path = os.path.join(daily_dir, "daily-%s.md" % ds)
        try:
            if os.path.getsize(path) < min_size:
                missing.append(ds + "(损坏)")
                continue
            with open(path, encoding="utf-8") as f:
                digests.append((ds, strip_frontmatter(f.read())))
        except UnicodeDecodeError:
            missing.append(ds + "(损坏)")
        except OSError:
            missing.append(ds)
    return digests, missing


def _req_str(obj, key, label, allow_empty=False):
    """取字符串字段：必须是 str，strip 后默认非空。"""
    v = obj.get(key)
    if not isinstance(v, str):
        raise WeeklyReportError("%s 必须是字符串" % label)
    v = v.strip()
    if not allow_empty and not v:
        raise WeeklyReportError("%s 不可为空" % label)
    return v


def _validate_weekly(data):
    """周报严格 schema，返回规范化 dict。文案与历史行为逐字一致。"""
    if not isinstance(data, dict):
        raise WeeklyReportError("顶层不是 JSON 对象")

    hl = data.get("headline")
    if not isinstance(hl, dict):
        raise WeeklyReportError("headline 缺失或不是对象")
    hl_title = _req_str(hl, "title", "headline.title")
    hl_summary = _req_str(hl, "summary", "headline.summary")

    items = data.get("items")
    if not isinstance(items, list) or not (5 <= len(items) <= 7):
        raise WeeklyReportError("items 必须为 5-7 条")

    norm_items = []
    n_path = 0
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            raise WeeklyReportError("items[%d] 不是对象" % i)
        kind = it.get("kind")
        if kind not in KIND_STYLE:
            raise WeeklyReportError("items[%d].kind 非法: %r" % (i, kind))
        title = _req_str(it, "title", "items[%d].title" % i)
        what = _req_str(it, "what", "items[%d].what" % i)
        why = _req_str(it, "why", "items[%d].why" % i, allow_empty=True)
        if kind == "path":
            n_path += 1
        elif not why:
            raise WeeklyReportError("items[%d] concept/idea 的 why 不可为空" % i)
        norm_items.append({"kind": kind, "title": title, "what": what, "why": why})
    if n_path > 2:
        raise WeeklyReportError("path 至多 2 条")
    if len(items) < 7 and n_path > 1:
        raise WeeklyReportError(
            "path 至多 2 条；items 为 5-6 条时 path 至多 1 条（概念/想法须占多数）")

    sig = data.get("signal")
    points = sig.get("points") if isinstance(sig, dict) else None
    if not isinstance(points, list) or not (3 <= len(points) <= 5):
        raise WeeklyReportError("signal.points 必须为 3-5 条非空字符串")
    norm_points = []
    for i, p in enumerate(points):
        label = "signal.points[%d]" % i
        if not isinstance(p, str):
            raise WeeklyReportError("%s 必须是字符串" % label)
        p = p.strip()
        if not p:
            raise WeeklyReportError("%s 不可为空" % label)
        norm_points.append(p)

    return {
        "headline": {"title": hl_title, "summary": hl_summary},
        "items": norm_items,
        "signal": {"points": norm_points},
    }


def parse_weekly_json(raw):
    """提取并校验周报；文案与历史逐字一致。"""
    try:
        return rc.extract_json(raw, validator=_validate_weekly)
    except rc.JsonExtractError as e:
        if e.reason is not None:
            raise WeeklyReportError(
                "输出中找不到合法的周报 JSON 对象；最后一次校验：%s" % e.reason
            ) from e
        raise WeeklyReportError("输出中找不到合法的周报 JSON 对象") from e


def issue_number(reports_dir, date_str=None):
    """下一期 = 已存档 weekly-*.md 数 + 1。

    同一天重跑同一份周报时沿用已有期号（幂等），避免 No.01 被改写成 No.02。
    """
    if date_str:
        path = os.path.join(reports_dir, "weekly-%s.md" % date_str)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    head = f.read(600)
            except OSError:
                head = ""
            m = __import__("re").search(r"No\.(\d+)", head)
            if m:
                return int(m.group(1))
    return len(glob.glob(os.path.join(reports_dir, "weekly-*.md"))) + 1


def _kind_tag_text(kind, seq):
    name = KIND_STYLE[kind][0]
    return name if kind == "path" else "%s %02d" % (name, seq)


def render_weekly_text(data, issue, date_str):
    lines = []
    lines.append("AI 技术与思路周报 · No.%02d" % issue)
    lines.append("WEEKLY · %s" % date_str.replace("-", "."))
    lines.append("=" * 34)
    lines.append("")
    lines.append("【本周头条】%s" % data["headline"]["title"])
    lines.append(data["headline"]["summary"])
    lines.append("")
    lines.append("-" * 34)

    seq = 0
    for it in data["items"]:
        if it["kind"] in ("concept", "idea"):
            seq += 1
        lines.append("")
        lines.append("【%s】%s" % (_kind_tag_text(it["kind"], seq), it["title"]))
        lines.append(it["what"])
        if it["why"]:
            lines.append("为什么重要：%s" % it["why"])

    lines.append("")
    lines.append("-" * 34)
    lines.append("就业与社会范式 · 本周信号")
    for p in data["signal"]["points"]:
        lines.append("· %s" % p)
    lines.append("")
    lines.append("=" * 34)
    lines.append("由本地 Agent 每周六自动编排生成 · 直推 QQ 邮箱")
    lines.append("概念为主，路径为辅 · 第 %02d 期" % issue)
    return "\n".join(lines)


def _tag_span(kind, seq):
    name, bg, fg = KIND_STYLE[kind]
    label = name if kind == "path" else "%s · %02d" % (name, seq)
    return (
        '<span style="display:inline-block;font-size:11px;font-weight:600;'
        'letter-spacing:1px;padding:3px 10px;border-radius:99px;'
        'background:%s;color:%s;">%s</span>' % (bg, fg, wt.esc(label)))


def _item_card(item, seq):
    why = ""
    if item["why"]:
        why = (
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" '
            'style="margin-top:12px;"><tr>'
            '<td style="border-left:3px solid %s;padding:1px 0 1px 12px;">'
            '%s</td></tr></table>'
            % (wt.QUOTE_BAR, wt.paras(item["why"], wt.TEXT_MUTED, size="12.5px")))
    return (
        '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" '
        'style="background:%s;border-radius:12px;margin:0 0 12px;">'
        '<tr><td style="padding:16px 18px;">'
        '%s'
        '<div style="font-family:%s;font-size:16px;'
        'line-height:1.45;color:%s;margin:10px 0 0;">%s</div>'
        '%s%s'
        '</td></tr></table>'
        % (wt.BG_CARD, _tag_span(item["kind"], seq),
           wt.TITLE_FONT, wt.TEXT_CARD_TITLE, wt.esc(item["title"]),
           wt.paras(item["what"], wt.TEXT_BODY), why))


def render_weekly_inner(data, issue, date_str):
    """面板内部 HTML（不含外壳）——博客详情页直接嵌这块。"""
    seq = 0
    cards = []
    for it in data["items"]:
        if it["kind"] in ("concept", "idea"):
            seq += 1
        cards.append(_item_card(it, seq))

    points = []
    for p in data["signal"]["points"]:
        points.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" width="100%%">'
            '<tr><td width="14" valign="top" style="color:%s;font-size:13px;">·</td>'
            '<td style="padding:0 0 8px;font-size:12.5px;line-height:1.7;color:%s;">'
            '%s</td></tr></table>' % (wt.GOLD_SOFT, wt.TEXT_SIGNAL, wt.esc(p)))

    dot = date_str.replace("-", ".")
    return (
        wt.header_row("AI 技术与思路周报", "No.%02d" % issue)
        + wt.kicker("WEEKLY · %s" % dot)
        + ('<div style="margin-top:12px;font-family:%s;font-size:24px;'
           'line-height:1.35;color:%s;">%s</div>'
           % (wt.TITLE_FONT, wt.TEXT_TITLE, wt.esc(data["headline"]["title"])))
        + wt.paras(data["headline"]["summary"], wt.TEXT_LEAD,
                   size="13.5px", first_margin="12px 0 0")
        + wt.divider()
        + "".join(cards)
        + wt.dashed_card("就业与社会范式 · 本周信号", "".join(points))
        + wt.divider(margin="22px 0 14px", bg="rgba(255,255,255,.07)")
        + wt.footer(["由本地 Agent 每周六自动编排生成 · 直推 QQ 邮箱",
                     "概念为主，路径为辅 · 第 %02d 期" % issue]))


def render_weekly_html(data, issue, date_str):
    return wt.panel_page("AI 技术与思路周报 No.%02d" % issue,
                         render_weekly_inner(data, issue, date_str))


def build_weekly_prompt(tpl, digests):
    """换入日报素材与聚合说明。"""
    if digests:
        dates = "、".join(ds for ds, _ in digests)
        note = "本周共聚合到 %d 份日报（日期倒序）：%s。" % (len(digests), dates)
        blocks = ["## %s 的日报\n\n%s" % (ds, content) for ds, content in digests]
        digest = "\n\n---\n\n".join(blocks)
    else:
        note = "本周无可用日报素材，本期全部依赖你的增量联网深研。"
        digest = "（本周无可用日报素材）"
    return tpl.replace("<<DIGEST_NOTE>>", note).replace("<<DAILY_DIGEST>>", digest)
