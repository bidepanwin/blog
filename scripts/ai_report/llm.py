#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DeepSeek 调用层：走 Anthropic 兼容端点 + 服务端 web_search 工具。

原邮箱版用 headless claude（--allowedTools WebSearch,WebFetch）；本仓库在
云端没有 claude CLI，改用 DeepSeek 的 /anthropic/v1/messages：同一条 prompt、
同一个服务端联网搜索工具，模型自行检索后一次性给出最终 JSON。纯标准库。
"""
import json
import os
import socket
import time
import urllib.error
import urllib.request

API_URL = os.environ.get("DEEPSEEK_ANTHROPIC_URL",
                         "https://api.deepseek.com/anthropic/v1/messages")
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro")
# web_search 服务端工具：每次调用可发起若干次检索；日报五维度约 10 次，留余量
SEARCH_MAX_USES = int(os.environ.get("DEEPSEEK_SEARCH_MAX_USES", "32"))
MAX_TOKENS = int(os.environ.get("DEEPSEEK_MAX_TOKENS", "32000"))
# 整次请求的硬顶（秒）：原版 claude 实测 9~14 分钟
TOTAL_TIMEOUT = int(os.environ.get("DEEPSEEK_TOTAL_TIMEOUT_SEC", "1500"))
# 单次网络读超时（秒）
READ_TIMEOUT = int(os.environ.get("DEEPSEEK_READ_TIMEOUT_SEC", "300"))
RETRY_TIMES = int(os.environ.get("DEEPSEEK_RETRY_TIMES", "2"))
RETRY_BACKOFF = int(os.environ.get("DEEPSEEK_RETRY_BACKOFF_SEC", "30"))


class LlmError(Exception):
    """调用层可预期错误。"""


def _api_key():
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not key:
        raise LlmError("缺少 DEEPSEEK_API_KEY")
    return key


def _payload(prompt, tools):
    body = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "stream": True,
        "messages": [{"role": "user", "content": prompt}],
    }
    if tools:
        body["tools"] = tools
    return body


def web_search_tool(max_uses=None):
    return {
        "type": "web_search_20260209",
        "name": "web_search",
        "max_uses": max_uses or SEARCH_MAX_USES,
    }


def _iter_sse(resp, deadline):
    """逐条产出 SSE 事件（dict）。到硬顶抛 LlmError。"""
    event = {}
    for raw in resp:
        if time.monotonic() > deadline:
            raise LlmError("请求超过总超时 %ds" % TOTAL_TIMEOUT)
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if not line:
            if event:
                yield event
                event = {}
            continue
        if line.startswith("event:"):
            event["event"] = line[6:].strip()
        elif line.startswith("data:"):
            data = line[5:].strip()
            if data == "[DONE]":
                continue
            try:
                event["data"] = json.loads(data)
            except ValueError:
                continue
    if event:
        yield event


def call(prompt, log=None, tools=None, model=None):
    """调用 DeepSeek，返回最终文本。tools 默认带联网搜索。

    流式读取：服务器端 web_search 事件逐个到达，日志里能看到检索进度，
    也避免长时间静默被中间层掐断。失败按基础设施类错误重试。
    """
    tools = [web_search_tool()] if tools is None else tools
    body = _payload(prompt, tools)
    if model:
        body["model"] = model
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")

    def _log(m):
        if log:
            log(m)

    attempt = 0
    while True:
        started = time.monotonic()
        deadline = started + TOTAL_TIMEOUT
        text_parts = []
        searches = 0
        stop_reason = None
        blocks = {}
        try:
            req = urllib.request.Request(
                API_URL, data=data, method="POST",
                headers={
                    "content-type": "application/json",
                    "x-api-key": _api_key(),
                    "anthropic-version": "2023-06-01",
                })
            with urllib.request.urlopen(req, timeout=READ_TIMEOUT) as resp:
                for ev in _iter_sse(resp, deadline):
                    d = ev.get("data") or {}
                    et = d.get("type")
                    if et == "message_start":
                        _log("llm: message_start model=%s"
                             % (d.get("message") or {}).get("model"))
                    elif et == "content_block_start":
                        blk = d.get("content_block") or {}
                        blocks[d.get("index")] = blk.get("type")
                        if blk.get("type") == "server_tool_use":
                            searches += 1
                            _log("llm: web_search #%d" % searches)
                    elif et == "content_block_delta":
                        delta = d.get("delta") or {}
                        if delta.get("type") == "text_delta":
                            text_parts.append(delta.get("text") or "")
                    elif et == "message_delta":
                        stop_reason = (d.get("delta") or {}).get("stop_reason") or stop_reason
                    elif et == "error":
                        raise LlmError("流式错误: %s" % json.dumps(d, ensure_ascii=False)[:300])
                    elif et == "ping":
                        pass
            text = "".join(text_parts)
            elapsed = int(time.monotonic() - started)
            _log("llm: done stop_reason=%s searches=%d elapsed=%ds chars=%d"
                 % (stop_reason, searches, elapsed, len(text)))
            if stop_reason == "max_tokens":
                raise LlmError("输出被 max_tokens 截断（stop_reason=max_tokens）")
            if not text.strip():
                raise LlmError("模型输出为空（stop_reason=%s）" % stop_reason)
            return text
        except (urllib.error.HTTPError) as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            err = "HTTP %s %s" % (e.code, detail)
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, LlmError) as e:
            err = "%s: %s" % (type(e).__name__, e)
        except Exception as e:  # noqa: BLE001 — 统一按可重试处理并记录
            err = "%s: %s" % (type(e).__name__, e)

        attempt += 1
        _log("WARN llm attempt %d failed: %s" % (attempt, err))
        if attempt > RETRY_TIMES:
            raise LlmError("DeepSeek 调用失败（已重试 %d 次）: %s" % (RETRY_TIMES, err))
        time.sleep(RETRY_BACKOFF)
