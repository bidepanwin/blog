#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""共享运行时：环境变量、日志、JSON 提取、multipart HTML 发信。纯标准库。

移植自原邮箱版 frontier-report/weekly-report/report_common.py：
剥离了 Windows 注册表回退与 headless claude 调用（本仓库改用 DeepSeek
Anthropic 兼容端点，见 llm.py），其余逻辑逐字保留。
"""
import ast
import json
import os
import re
import smtplib
import time
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate

# sendmail 成功完成前可安全重试的异常：连接/握手/认证/发送数据阶段。
# sendmail 一旦成功返回即定局，此后的异常（断连/quit 失败等）不在此列，
# 禁止重试以免重复发信。
_RETRIABLE_MAIL_ERRORS = (
    smtplib.SMTPConnectError,
    smtplib.SMTPHeloError,
    smtplib.SMTPNotSupportedError,
    smtplib.SMTPAuthenticationError,
    smtplib.SMTPSenderRefused,
    smtplib.SMTPRecipientsRefused,
    smtplib.SMTPDataError,
    OSError,
)


class ReportError(Exception):
    """共享运行时可预期错误基类。"""


class JsonExtractError(ReportError):
    """三级提取均失败。reason=最近一次 schema 校验错误字符串（纯垃圾时为 None）。"""
    def __init__(self, message, reason=None):
        super().__init__(message)
        self.reason = reason


def strip_ansi(text):
    return re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)


def get_env(name, default=""):
    return os.environ.get(name) or default


def make_logger(log_path):
    """返回绑定到固定文件的 log(msg)；写盘失败静默（不影响主流程）。"""
    def log(msg):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        line = "[%s] %s" % (ts, msg)
        print(line, flush=True)
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass
    return log


def extract_json(raw, validator=None):
    """从模型原始输出提取对象。容忍 ANSI、```json 围栏、正文前噪声
    （警告/遥测小 JSON）、Python repr（单引号）。

    validator(obj) 给定：每个语法合法候选都过它，通过即返回其（规范化）结果；
    validator 抛异常则记录 str(异常) 作为最近原因并继续找下一候选。
    无 validator：返回首个语法合法对象。全部失败抛 JsonExtractError(reason=...)。
    """
    s = strip_ansi(raw).strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)

    last_reason = None

    def _check(obj):
        if validator is None:
            return obj
        try:
            return validator(obj)
        except Exception as e:
            nonlocal last_reason
            last_reason = str(e)
            return None

    # 1) JSON 游标扫描：raw_decode 成功后游标跳到该值末尾（跳过嵌套与前置噪声）
    decoder = json.JSONDecoder()
    pos = 0
    while True:
        i = s.find("{", pos)
        if i < 0:
            break
        try:
            obj, end = decoder.raw_decode(s, i)
        except Exception:
            pos = i + 1
            continue
        got = _check(obj)
        if got is not None:
            return got
        pos = end

    # 2) 逐行 Python 字面量（repr 周报/日报独占整行的真实形态）
    for line in s.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = ast.literal_eval(line)
        except Exception:
            continue
        got = _check(obj)
        if got is not None:
            return got

    # 3) 整段 Python 字面量：首 '{' 到末 '}'
    a, b = s.find("{"), s.rfind("}")
    if a != -1 and b > a:
        try:
            obj = ast.literal_eval(s[a:b + 1])
        except Exception:
            pass
        else:
            got = _check(obj)
            if got is not None:
                return got

    raise JsonExtractError("no valid json object", reason=last_reason)


def send_html_mail(host, port, user, pw, to, subject, text_body, html_body,
                   sleep_fn=time.sleep, smtp_factory=None, logger=None):
    """发 multipart/alternative。重试 3 次、退避 15/45（末次不等待）。
    重试以 sendmail 是否成功完成为界：连接/握手/认证/发送数据阶段的
    _RETRIABLE_MAIL_ERRORS 才重试；sendmail 成功返回后发生的任何异常
    （断连/quit 失败）都按成功返回、不重试。全败抛 ReportError。
    port=465 走 SSL，其余端口走 STARTTLS（与原版 587 行为一致）。"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = user
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    raw = msg.as_string()

    def _log(m):
        if logger is None:
            return
        try:
            logger(m)
        except Exception:
            pass

    use_ssl = int(port) == 465
    if smtp_factory is None:
        smtp_factory = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP

    delays = [15, 45]
    last_err = None
    for attempt in range(3):
        s = None
        try:
            s = smtp_factory(host, port, timeout=30)  # 构造即连接，self._host 正确
            s.ehlo()
            if not use_ssl:
                s.starttls()
                s.ehlo()
            s.login(user, pw)
            s.sendmail(user, [x.strip() for x in to.split(",") if x.strip()], raw)
        except _RETRIABLE_MAIL_ERRORS as e:
            # sendmail 未成功完成（服务端未确认接收），重试不会重复发信
            last_err = e
            _log("WARN mail attempt %d failed: %s" % (attempt + 1, e))
            try:
                if s is not None:
                    s.quit()
            except Exception:
                pass
            if attempt < 2:
                sleep_fn(delays[attempt])
            continue
        except Exception as e:
            # 未预期异常：状态不明，不重试（避免对未知状态重发）
            _log("WARN mail attempt %d unexpected error, no retry: %s" % (attempt + 1, e))
            try:
                if s is not None:
                    s.quit()
            except Exception:
                pass
            raise ReportError("未预期错误（不重试）: %s" % e) from e
        # sendmail 已成功返回：邮件已被服务端接收，此后任何失败均不重试
        try:
            s.quit()
        except Exception as e:
            _log("WARN 邮件可能已发出，但 sendmail 成功后断连/quit 失败（按成功处理，不重试）: %s" % e)
        _log("mail sent (attempt %d) to %s" % (attempt + 1, to))
        return
    raise ReportError("3 次尝试均失败: %s" % last_err)
