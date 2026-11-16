# AI 日报自动化执行记录

## 2026-11-16 运行（报道 D-1 = 2026-11-15）

- 结果：成功发布并推送。commit `350d704`，线上 https://bidepanwin.github.io/blog/posts/ai-daily-2026-11-15/
- 新增文件：`src/content/posts/ai-daily-2026-11-15.md` + `public/images/ai-daily/2026-11-15-1.webp`（仅 1 张）
- 当天（周六）核心事件：Anthropic IPO 定价前夜（认购 6 倍、11-19 挂牌、估值约 1.4 万亿）；英伟达领投 100 亿 + 7 家 260 亿私募配售；TSMC 各 5 亿投资 OpenAI/Anthropic；黄仁勋换帅风波发酵（请愿 11.5 万签名）；OpenAI 开设科学博客（当天官方发布，首篇 GPT-6 Astra 格点研究）。
- 配图：1 张，来自 OpenAI 官方博客文章配图（经网易科技转载的格点研究示意图）。当天以资本/人事事件为主，Anthropic IPO、英伟达换帅均无实体官方配图；Claude for Manufacturing（11-12 发布）因日期不属 D-1，为避免图文错位已弃用其配图，故仅配 1 张并已如实说明。
- 门禁：astro check 0 errors；build 成功；check:manifest 通过；type-check 仅 6 个 TS9013 文档豁免告警。全部通过。digital-garden.md 本次未被改写，无需 restore。
- 推送：前两次因 github.com 连接超时失败，第 3 次成功。
- 后续调整（同日 18:30）：用户反馈原配图（OpenAI 格点学术示意图）与资本主线不匹配、且封面与正文重复。已按「宁缺毋滥」删除该插图并删除 webp，封面改用站内通用图 `/images/garden/workspace.webp`，commit `782abd9`。教训：资本/人事类事件的日报，官方几乎无实体配图，学术示意图当封面会突兀；无合适官方图时直接不配实体插图，封面用站内通用图，并在「信息说明」如实说明。
- 后续调整 2（同日 18:35）：用户要求换 Anthropic 相关图。最终封面改用 Anthropic 官方 logo（取自 S-1 招股书公告页 anthropic.com/news/s1-sec 的 og:image，assets.claude.com/6d4a0d...jpg，alt="Anthropic logo"），对位「Anthropic IPO」核心事件，commit `f5f137d`。关键经验：Anthropic 官方在 IPO 上唯一对外视觉资产就是公司 logo（S-1 页与首页 og:image 均为它）；claude.com 首页另有 Claude 产品 logo（f6607107...jpg）。讲「Anthropic 公司 IPO」用公司 logo，讲「Claude 产品」才用产品 logo。logo 图可直接转 webp 当封面，来源标注 S-1 公告页即可。

## 经验备忘（补充）

- 11-15 为周六，全球重磅模型/产品发布极少，当日重心在资本事件；多份「11-15 日报」实为对 11-11~11-14 事件的滞后汇总，须逐条核对官方发布日期（Claude for Manufacturing=11-12、Kitesurf 开源=11-12/13、Praxis-1=11-11、DeepSeek 全家桶 API=11-13、ChatGPT Wallet=11-13、Gemini 4 Hydrogen=11-14、黄仁勋卸任=11-13）。
- OpenAI 官方博客 openai.com 页面 curl/WebFetch 均 403 或 JS 渲染拿不到图；经网易科技(163.com)转载可拿到正文配图（nimg.ws.126.net，需 URL 编码访问）。
- Anthropic assets.claude.com 可达，但 S-1/新闻页配图均为抽象装饰图或 logo，无 IPO 事件实体图；其产品博客 og:image 是动态生成（/opengraph-image/og）。

## 2026-11-15 运行（报道 D-1 = 2026-11-14）

- 结果：成功发布并推送。commit `dc83774`，线上 https://bidepanwin.github.io/blog/posts/ai-daily-2026-11-14/
- 新增文件：`src/content/posts/ai-daily-2026-11-14.md` + `public/images/ai-daily/2026-11-14-1.webp`、`-2.webp`
- 配图：2 张，均来自 Google 官方博客「Introducing Gemini 4 Hydrogen」发布配图（key visual + 能力对比演示图）。因本机网络 x.com / pbs.twimg.com / cdn.openai.com / openai.com 不通、NVIDIA/Anthropic 当日事件页无专属配图，官方可获取的事件相关图仅 Google 这一来源，故两图同源但内容不同，已在文中如实标注。
- 门禁：astro check 0 errors；build 成功；check:manifest 通过；type-check 仅 6 个 TS9013 文档豁免告警。全部通过。
- 已知事项：build 产生 `D src/generated/local-icon-collections.ts.tmp` 副作用（未暂存、未碰）；本次 digital-garden.md 未被改写，无需 restore。

## 经验备忘

- 图片降级链实际可用源：storage.googleapis.com（Google 官方博客配图）可达；blog.google / deepmind.google 可达；anthropic.com / claude.com / nvidianews.nvidia.com / blogs.nvidia.com 可达但当日相关文章多为纯文字或无事件专属配图。
- OpenAI 页面 curl 返回 403（反爬），WebFetch 可读正文但 ChatGPT Wallet 公告无 og:image 也无正文配图。
- 事件日期需严格锚定 D-1：AlphaGenome 2 为 11-11、Claude Managed Agents 自托管为 11-12，均不属 D-1=11-14 新事件，已排除。
- /tmp 在 Windows Git Bash 下 node(sharp) 读不到，需先 cp 到项目内再处理。
