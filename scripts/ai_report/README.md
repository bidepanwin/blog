# AI 前沿日报 / 技术与思路周报（云端版）

严格对齐原邮箱版 `frontier-report`（`daily-report/` + `weekly-report/`）的产物：
同一条 prompt、同一个严格 JSON 契约、同一套 schema 校验、同一份暖陶暗色 HTML
与纯文本，QQ 邮箱直推；额外把两份产物写进博客。

## 与原版的唯一差异

| 维度 | 原邮箱版 | 本仓库 |
|---|---|---|
| 生成端 | headless `claude -p --allowedTools WebSearch,WebFetch`（本机） | DeepSeek Anthropic 兼容端点 `api.deepseek.com/anthropic/v1/messages` + 服务端 `web_search` 工具（云端） |
| 触发 | Windows 计划任务 | GitHub Actions（北京 08:00 日报、周六 08:30 周报） |
| 归档位置 | `C:\Users\26404\.claude\daily-report\*.md` | `src/content/reports/*.md` + `src/data/reports/*.html` |

schema 校验器、`render_*_text/html`、`warm_theme.py` 的每个函数都逐字保留，
改动只发生在运行环境（见 `llm.py`）。

## 目录

```
scripts/ai_report/
├── warm_theme.py   原版主题，逐字复制
├── common.py       extract_json / send_html_mail / 日志（剥离 winreg 与 claude）
├── daily.py        日报 schema + 渲染（逐字移植）
├── weekly.py       周报 schema + 渲染（逐字移植）
├── llm.py          DeepSeek 调用层（流式 + 联网搜索 + 重试）
├── run.py          编排与发布
└── prompts/        daily.md / weekly.md（原版 prompt，逐字复制）
```

## 产物

- `src/content/reports/daily-YYYY-MM-DD.md` / `weekly-YYYY-MM-DD.md`
  frontmatter + 纯文本正文（列表页、搜索、存档用）
- `src/data/reports/<同上>.html` 暖陶面板内部 HTML，详情页 `set:html` 直接嵌入，
  与邮件正文逐像素一致（邮件用同一份 HTML 加 `<html>/<body>` 外壳）
- 邮件：HTML + 纯文本 multipart/alternative，主题与原版一致
  （`AI前沿日报 - YYYY-MM-DD` / `AI 技术与思路周报 - YYYY-MM-DD`）

## 运行

```bash
python3 scripts/ai_report/run.py daily            # 生成 + 发信
python3 scripts/ai_report/run.py daily --no-email # 只生成
python3 scripts/ai_report/run.py weekly
python3 scripts/ai_report/run.py daily --date 2026-10-20  # 补发指定日期（附补发说明）
python3 scripts/ai_report/run.py daily --catchup        # 补最近 7 天缺口（最多 3 天）后照常生成
python3 scripts/ai_report/run.py daily --resend         # 不重新生成，把已归档那篇原样重发一封邮件
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 必填，GitHub Secrets |
| `DEEPSEEK_MODEL` | 默认 `deepseek-v4-pro` |
| `SMTP_HOST` / `SMTP_PORT` | 默认 `smtp.qq.com` / `465`（465 走 SSL，其余走 STARTTLS） |
| `SMTP_USER` / `SMTP_PASS` | 发件邮箱与授权码（也接受 `QQ_SMTP_USER` / `QQ_SMTP_PASS`） |
| `REPORT_TO_EMAIL` | 收件邮箱（也接受 `QQ_SMTP_TO`，逗号分隔多个） |
| `REPORT_DRY_RUN` | 非空则只生成不发信（workflow_dispatch 的 dry_run 输入）|

## 部署联动

`GITHUB_TOKEN` 推送的提交不会触发 push 类工作流，所以 workflow 在提交后
用 `gh workflow run deploy.yml` 显式派发一次部署（需要 `actions: write`）。
