# claude-skills — 写作流程用的 Claude 技能（备份）

这里放的是**运行时技能的快照**，真正的生效位置在：

```
C:\Users\26404\.claude\skills\{wp,iv,help}\SKILL.md
```

放在仓库里只是为了跟着项目走、换机器能恢复，**不会被打包进网站**。

## 三个技能

| 技能 | 作用 |
|---|---|
| `/wp` | 微信来稿 → 博文 / moment。先出草稿到 `drafts/`，确认后才入库 |
| `/iv` | AI 采访 → 结构化成文。8-12 问，每答追一层 |
| `/help` | 列出常用技能 |

## 恢复方法

```bash
mkdir -p ~/.claude/skills
cp -r claude-skills/* ~/.claude/skills/
```

## 配套约定

- `inbox/`：微信来稿收件箱（原文放这里，整理后移到 `inbox/_done/`）
- `drafts/`：成稿草稿区，确认后才移进 `src/content/`
- `drafts/_originals/`：原文留档与风格对照语料
- `scripts/style-pairs.py`：从 moments 抽取「原文→成文」对照，扩充风格语料

风格画像在共享记忆层：`C:\Users\26404\.hermes\shared-memory\user-writing-style.md`。

## 铁律

成文**只能删改原文，不能新增句子**。细节见 `wp` 技能第三节。
