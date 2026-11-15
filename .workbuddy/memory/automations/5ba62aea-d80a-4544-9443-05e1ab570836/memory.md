# AI 日报自动化执行记录

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
