#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 前沿日报：严格 JSON 契约 + 校验 + 纯文本/暖陶 HTML 渲染。

除「生成端由 claude 换成 DeepSeek」外，schema 校验、文案、HTML 结构逐字
移植自原邮箱版 frontier-report/daily-report/daily_report.py。
"""
import datetime

import common as rc
import warm_theme as wt

SECTION_IDS = ["people", "companies", "events", "policy", "hackathons"]
SECTION_TITLES = {
    "people": ("领军人物", "PEOPLE"),
    "companies": ("公司与产业链", "COMPANIES"),
    "events": ("重大事件", "EVENTS"),
    "policy": ("政策与监管", "POLICY"),
    "hackathons": ("赛事机会", "HACKATHONS"),
}
HACK_ITEMS_MAX = 6

# companies 的 group 契约是「基础层/技术层/应用层」；模型偶尔会交错输出，
# 这里按固定顺序稳定排序，使同一 group 的条目相邻（内容与顺序内相对关系不变）。
_GROUP_ORDER = {"基础层": 0, "技术层": 1, "应用层": 2}


class DailyReportError(Exception):
    """日报链路可预期错误。"""


def _req_str(obj, key, label):
    v = obj.get(key)
    if not isinstance(v, str):
        raise DailyReportError("%s 必须是字符串" % label)
    v = v.strip()
    if not v:
        raise DailyReportError("%s 不可为空" % label)
    return v


def _validate_item(obj, idx):
    if not isinstance(obj, dict):
        raise DailyReportError("sections.items[%d] 不是对象" % idx)
    name = _req_str(obj, "name", "items[%d].name" % idx)
    text = _req_str(obj, "text", "items[%d].text" % idx)
    g = obj.get("group", "")
    if not isinstance(g, str):
        raise DailyReportError("items[%d].group 必须是字符串" % idx)
    return {"name": name, "text": text, "group": g.strip()}


def _validate_hack_item(obj, idx):
    """赛事条目：name/text/group(地点)/deadline(报名截止)/url(报名页)。"""
    if not isinstance(obj, dict):
        raise DailyReportError("hackathons.items[%d] 不是对象" % idx)
    label = "hackathons.items[%d]" % idx
    name = _req_str(obj, "name", label + ".name")
    text = _req_str(obj, "text", label + ".text")
    group = _req_str(obj, "group", label + ".group")
    deadline = _req_str(obj, "deadline", label + ".deadline")
    url_raw = obj.get("url", "")
    if not isinstance(url_raw, str):
        raise DailyReportError("%s.url 必须是字符串" % label)
    url = url_raw.strip()
    try:
        d = datetime.datetime.strptime(deadline, "%Y-%m-%d").date()
    except ValueError:
        raise DailyReportError("%s.deadline 必须为 YYYY-MM-DD 格式" % label)
    today = datetime.date.today()
    if d < today:
        raise DailyReportError(
            "%s.deadline（%s）已过，仅收今天仍可报名的赛事" % (label, deadline))
    # url 可缺省：部分赛事仅支持 App/公众号报名，报名渠道写入 text；
    # 一旦给了 url 就必须是合法的 http(s) 官方报名页。
    if url:
        low = url.lower()
        if not (low.startswith("http://") or low.startswith("https://")):
            raise DailyReportError("%s.url 必须以 http(s):// 开头" % label)
    return {"name": name, "text": text, "group": group,
            "deadline": d.isoformat(), "url": url}


def _validate_section(obj, idx):
    if not isinstance(obj, dict):
        raise DailyReportError("sections[%d] 不是对象" % idx)
    sid = obj.get("id")
    if idx >= len(SECTION_IDS) or sid != SECTION_IDS[idx]:
        expected = SECTION_IDS[idx] if idx < len(SECTION_IDS) else "<非法位置>"
        raise DailyReportError(
            "sections[%d].id 必须为 %s（顺序锁定），实际 %r" % (idx, expected, sid))
    is_hack = sid == "hackathons"
    cap = HACK_ITEMS_MAX if is_hack else 12
    items = obj.get("items")
    if not isinstance(items, list) or len(items) > cap:
        raise DailyReportError("sections[%d].items 必须为 0-%d 条数组" % (idx, cap))
    item_validator = _validate_hack_item if is_hack else _validate_item
    norm = [item_validator(it, j) for j, it in enumerate(items)]
    if sid == "companies":
        norm.sort(key=lambda it: _GROUP_ORDER.get(it["group"], len(_GROUP_ORDER)))
    return {"id": sid, "items": norm}


def _validate_deep(obj, idx):
    if not isinstance(obj, dict):
        raise DailyReportError("deep_reads[%d] 不是对象" % idx)
    title = _req_str(obj, "title", "deep_reads[%d].title" % idx)
    url = _req_str(obj, "url", "deep_reads[%d].url" % idx)
    why = _req_str(obj, "why", "deep_reads[%d].why" % idx)
    low = url.lower()
    if not (low.startswith("http://") or low.startswith("https://")):
        raise DailyReportError("deep_reads[%d].url 必须以 http(s):// 开头" % idx)
    return {"title": title, "url": url, "why": why}


def _validate_daily(data):
    if not isinstance(data, dict):
        raise DailyReportError("顶层不是 JSON 对象")

    briefs = data.get("briefs")
    if not isinstance(briefs, list) or not (3 <= len(briefs) <= 5):
        raise DailyReportError("briefs 必须为 3-5 条字符串")
    norm_briefs = []
    for i, b in enumerate(briefs):
        if not isinstance(b, str):
            raise DailyReportError("briefs[%d] 必须是字符串" % i)
        b = b.strip()
        if not b:
            raise DailyReportError("briefs[%d] 不可为空" % i)
        norm_briefs.append(b)

    sections = data.get("sections")
    if not isinstance(sections, list) or len(sections) != 5:
        raise DailyReportError("sections 必须为固定 5 个元素")
    norm_sections = [_validate_section(s, i) for i, s in enumerate(sections)]

    deeps = data.get("deep_reads")
    if not isinstance(deeps, list) or not (1 <= len(deeps) <= 2):
        raise DailyReportError("deep_reads 必须为 1-2 条")
    norm_deeps = [_validate_deep(d, i) for i, d in enumerate(deeps)]

    return {"briefs": norm_briefs, "sections": norm_sections,
            "deep_reads": norm_deeps}


def _bracket_stack(text, end):
    """text[:end] 在字符串外的括号栈；感知单/双引号字符串与反斜杠转义。"""
    stack = []
    instr = False
    quote = ""
    esc = False
    for ch in text[:end]:
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                instr = False
            continue
        if ch in ("'", '"'):
            instr = True
            quote = ch
        elif ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if stack:
                stack.pop()
    return stack


def _repair_missing_sections_bracket(raw):
    """窄修复：最后一个 section 后漏了关闭 sections 数组的 ']'。仅当
    deep_reads 键前括号栈恰为顶层 { + sections [ 时，在分隔逗号前补 ']'；
    任何不确定情形返回 None，绝不猜括号。修后仍须过完整 literal_eval +
    schema 双关。"""
    import re
    m = re.search(r"(['\"])deep_reads\1\s*:", raw)
    if not m:
        return None
    q = m.start() - 1
    while q >= 0 and raw[q] in " \t\r\n":
        q -= 1
    if q < 0 or raw[q] != ",":  # 键前必须是 sections 与 deep_reads 的分隔逗号
        return None
    if _bracket_stack(raw, q) != ["{", "["]:
        return None
    return raw[:q] + "]" + raw[q:]


def parse_daily_json(raw, log=None):
    """提取并校验日报；常规解析全败后，对已确认的「sections 漏 ]」窄模式
    自动修复重试一次。"""
    try:
        return rc.extract_json(raw, validator=_validate_daily)
    except rc.JsonExtractError as first:
        repaired = _repair_missing_sections_bracket(raw)
        if repaired is not None:
            if log:
                log("auto-repair: 检测到 sections 漏 ]，已自动补齐并重试解析")
            try:
                return rc.extract_json(repaired, validator=_validate_daily)
            except rc.JsonExtractError:
                pass  # 修后仍不过 schema，按原失败处理
        if first.reason is not None:
            raise DailyReportError(
                "输出中找不到合法的日报 JSON 对象；最后一次校验：%s" % first.reason
            ) from first
        raise DailyReportError("输出中找不到合法的日报 JSON 对象") from first


_CIRCLED = ["①", "②", "③", "④", "⑤"]


def _days_left(deadline, ref=None):
    d = datetime.datetime.strptime(deadline, "%Y-%m-%d").date()
    return (d - (ref or datetime.date.today())).days


def render_daily_text(data, date_str, backfill=None):
    ref = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
    L = []
    L.append("AI 前沿日报 · %s" % date_str)
    L.append("DAILY · %s" % date_str.replace("-", "."))
    if backfill:
        L.append("【补发】回溯覆盖 %s 前后 24 小时动态，实际生成于 %s；"
                 "受检索索引限制，历史覆盖可能不全。" % (date_str, backfill))
    L.append("=" * 34)
    L.append("")
    L.append("◆ 今日速览")
    for i, b in enumerate(data["briefs"]):
        L.append("%s %s" % (_CIRCLED[i], b))

    for sec in data["sections"]:
        if not sec["items"]:
            continue
        cn, en = SECTION_TITLES[sec["id"]]
        L.append("")
        L.append("-" * 34)
        L.append("%s · %s" % (cn, en))
        if sec["id"] == "hackathons":
            for it in sec["items"]:
                days = _days_left(it["deadline"], ref)
                countdown = "今天截止" if days == 0 else "剩%d天" % days
                L.append("· %s（%s｜报名截止 %s，%s）"
                         % (it["name"], it["group"], it["deadline"], countdown))
                L.append("  %s" % it["text"])
                if it["url"]:
                    L.append("  报名：%s" % it["url"])
            continue
        last_group = None
        for it in sec["items"]:
            if sec["id"] == "companies" and it["group"] and it["group"] != last_group:
                L.append("【%s】" % it["group"])
                last_group = it["group"]
            L.append("· %s：%s" % (it["name"], it["text"]))

    L.append("")
    L.append("-" * 34)
    L.append("值得深读")
    for d in data["deep_reads"]:
        L.append("· %s" % d["title"])
        L.append("  %s" % d["url"])
        L.append("  推荐：%s" % d["why"])

    L.append("")
    L.append("=" * 34)
    L.append("由本地 Agent 每天自动编排生成 · 直推 QQ 邮箱")
    return "\n".join(L)


def _brief_html(briefs):
    rows = []
    for i, b in enumerate(briefs):
        rows.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" width="100%%">'
            '<tr><td width="24" valign="top" '
            'style="font-size:12px;font-weight:700;color:%s;">%02d</td>'
            '<td style="padding:0 0 8px;font-size:12.5px;line-height:1.7;color:%s;">%s</td>'
            '</tr></table>'
            % (wt.ACCENT, i + 1, wt.TEXT_SIGNAL, wt.esc(b)))
    return "".join(rows)


def _section_html(sec):
    items = sec["items"]
    if not items:
        return ""
    cn, en = SECTION_TITLES[sec["id"]]
    head = (
        '<div style="margin:22px 0 10px;">'
        '<span style="font-family:%s;font-size:15px;color:%s;">%s</span>'
        '<span style="font-size:10px;letter-spacing:2px;color:%s;margin-left:8px;">%s</span>'
        '</div>'
        % (wt.TITLE_FONT, wt.TEXT_CARD_TITLE, wt.esc(cn), wt.TEXT_RIGHT, en))

    rows = []
    last_group = None
    for it in items:
        if sec["id"] == "companies" and it["group"] and it["group"] != last_group:
            rows.append(
                '<div style="font-size:10.5px;letter-spacing:1px;color:%s;margin:8px 0 2px;">%s</div>'
                % (wt.GOLD_SOFT, wt.esc(it["group"])))
            last_group = it["group"]
        rows.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" width="100%%">'
            '<tr><td style="padding:6px 0;border-top:1px solid rgba(255,255,255,.05);">'
            '<span style="font-size:12.5px;font-weight:600;color:%s;">%s：</span>'
            '<span style="font-size:12.5px;color:%s;">%s</span>'
            '</td></tr></table>'
            % (wt.ACCENT_SOFT, wt.esc(it["name"]), wt.TEXT_BODY, wt.esc(it["text"])))
    return head + "".join(rows)


def _hack_section_html(sec):
    """赛事卡片：名称 + 城市胶囊 + 简介 + 截止倒计时 + 报名链接。"""
    items = sec["items"]
    if not items:
        return ""
    cn, en = SECTION_TITLES[sec["id"]]
    head = (
        '<div style="margin:22px 0 10px;">'
        '<span style="font-family:%s;font-size:15px;color:%s;">%s</span>'
        '<span style="font-size:10px;letter-spacing:2px;color:%s;margin-left:8px;">%s</span>'
        '</div>'
        % (wt.TITLE_FONT, wt.TEXT_CARD_TITLE, wt.esc(cn), wt.TEXT_RIGHT, en))

    cards = []
    for it in items:
        days = _days_left(it["deadline"])
        countdown = "今天截止" if days == 0 else "剩 %d 天" % days
        if it["url"]:
            # 有网页报名页：左截止信息，右「立即报名」按钮
            bottom = (
                '<table role="presentation" cellpadding="0" cellspacing="0" width="100%%" '
                'style="margin-top:9px;"><tr>'
                '<td style="font-size:11px;color:%s;">⏳ %s · %s</td>'
                '<td align="right"><a href="%s" style="font-size:11.5px;font-weight:600;'
                'color:%s;text-decoration:none;">立即报名 &rarr;</a></td>'
                '</tr></table>'
                % (wt.GOLD, wt.esc(it["deadline"]), countdown,
                   wt.esc(it["url"]), wt.GOLD))
        else:
            # 仅 App/公众号报名：不显示按钮，具体渠道已写入 text
            bottom = (
                '<div style="margin-top:9px;font-size:11px;color:%s;">'
                '⏳ %s · %s</div>'
                % (wt.GOLD, wt.esc(it["deadline"]), countdown))
        cards.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" width="100%%" '
            'style="background:%s;border-radius:10px;margin:9px 0 0;">'
            '<tr><td style="padding:11px 14px 10px;">'
            '<span style="font-size:12.5px;font-weight:700;color:%s;">%s</span>'
            '<span style="display:inline-block;margin-left:7px;padding:1px 8px;'
            'border-radius:99px;background:rgba(204,120,92,.16);font-size:10px;color:%s;">%s</span>'
            '<div style="font-size:12px;line-height:1.65;color:%s;margin-top:5px;">%s</div>'
            '%s'
            '</td></tr></table>'
            % (wt.BG_CARD, wt.ACCENT_SOFT, wt.esc(it["name"]),
               wt.ACCENT, wt.esc(it["group"]),
               wt.TEXT_BODY, wt.esc(it["text"]), bottom))
    return head + "".join(cards)


def _deep_html(deeps):
    rows = []
    for d in deeps:
        rows.append(
            '<div style="margin:0 0 12px;">'
            '<a href="%s" style="font-size:12.5px;font-weight:600;color:%s;'
            'text-decoration:none;">%s</a>'
            '<div style="font-size:12px;line-height:1.65;color:%s;margin-top:3px;">%s</div>'
            '</div>'
            % (wt.esc(d["url"]), wt.GOLD, wt.esc(d["title"]),
               wt.TEXT_MUTED, wt.esc(d["why"])))
    return "".join(rows)


def render_daily_inner(data, date_str, backfill=None):
    """面板内部 HTML（不含 <html>/<body> 外壳）——博客详情页直接嵌这块。"""
    dot = date_str.replace("-", ".")
    banner = ""
    if backfill:
        banner = (
            '<div style="margin-top:14px;padding:9px 12px;border-left:3px solid %s;'
            'background:%s;border-radius:0 8px 8px 0;font-size:11.5px;line-height:1.65;'
            'color:%s;">【补发】回溯覆盖 %s 前后 24 小时动态，实际生成于 %s；'
            '受检索索引限制，历史覆盖可能不全。</div>'
            % (wt.QUOTE_BAR, wt.BG_SIGNAL, wt.TEXT_MUTED,
               wt.esc(date_str), wt.esc(backfill)))
    briefs_block = (
        '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" '
        'style="background:%s;border-radius:10px;">'
        '<tr><td style="padding:13px 16px 6px;">'
        '<div style="font-size:11px;letter-spacing:2px;color:%s;margin-bottom:8px;">今日速览</div>'
        '%s</td></tr></table>'
        % (wt.BG_SIGNAL, wt.ACCENT, _brief_html(data["briefs"])))

    sections = "".join(
        _hack_section_html(s) if s["id"] == "hackathons" else _section_html(s)
        for s in data["sections"])
    deep_card = wt.dashed_card("值得深读 · DEEP READ", _deep_html(data["deep_reads"]))

    return (
        wt.header_row("AI 前沿日报", "DAILY")
        + wt.kicker("DAILY · %s" % dot)
        + '<div style="height:14px;"></div>'
        + banner
        + briefs_block
        + sections
        + '<div style="height:18px;"></div>'
        + deep_card
        + wt.divider(margin="22px 0 14px")
        + wt.footer(["由本地 Agent 每天自动编排生成 · 直推 QQ 邮箱"]))


def render_daily_html(data, date_str, backfill=None):
    dot = date_str.replace("-", ".")
    return wt.panel_page("AI 前沿日报 %s" % dot,
                         render_daily_inner(data, date_str, backfill))
