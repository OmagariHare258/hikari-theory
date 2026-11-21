# 跨会话事务台（方案 B）+ 语音语速 +6%

日期：2026-11-05

## 1. 需求

用户选了**方案 B**：小光要能穿梭多个群/对话，帮人把某些内容转到别的群/好友、把群信息整理后私发；关键是要有「跨聊天处理信息」的能力，但普通会话的 token 不能被放开成任意读写。同时语音语速稍微加快一点。

## 2. 设计：普通会话只发起，真正跨会话在一次性事务台里做

```
主人私聊会话（agent token 只能动自己）
   │  qq_cross_task(task, readKeys, sendTargets)
   ▼
桥接校验（主人 / 白名单 / 私聊→群策略 / 每日次数）
   │  新建独立 DSH 会话（不写进 QQ 会话表 / 事件流不影响 QQ 回复）
   ▼
事务台会话（一次性 token，scope 写死在提示词里）
   ├─ qq_peek_conversation(可读会话)   ← 只读范围内 recentMessages
   ├─ qq_cross_send(可发目标, text)    ← 敏感扫描 + 每任务最多 10 条
   └─ qq_cross_finish(summary)         ← 回报发起人、归档会话、删 token
```

- 普通会话**没有**任何直接跨会话读/写能力；只能请求开事务台。
- 事务台跑在**独立的 DSH session**里，不与 QQ 会话映射（`reverse`/`state.sessions` 都不登记），所以不会触发 QQ 回复、收尾、记忆写入；
  会话结束即 `archiveSession`，token 从 `crossTasks` 和 `KNOWN_AGENT_TOKENS` 删除。
- 事务台超时（默认 10 分钟）自动结束并回报「超时」。

## 3. 安全边界（写死在代码/提示词里）

| 规则 | 值 |
| --- | --- |
| 谁能发起 | 主人 / 白名单里的人 = **不限次**；好感度 ≥60 = **每天 5 次**；其他人 = **每天 3 次**（按请求人、不是按会话；群聊取最后说话的人） |
| 能读哪些会话 | 只能读请求里 `readKeys` 且**当前模式+白名单**允许的会话 |
| 能发到哪 | 只能发 `sendTargets` 里的、且必须过白名单 |
| 私聊→群 | **允许**，由小光按内容/隐私自审（要硬拦可配 `allowPrivateToGroup=false`） |
| 群→私聊 | **允许**，由小光自审；不再限制只能发发起人/主人 |
| 转给第三方 | 允许；小光参考内容、隐私、好感度自行决定转不转/转多少 |
| 转述方式（2026-11-05 追加） | **可以用小光自己的口吻复述**，不必逐字照搬原话；但「谁说的/数字/时间/条件/约定」不能改，不编造不添油加醋；必须原样保留的引用用引号括起来并注明来源 |
| 敏感信息 | `SENSITIVE_RE` + 会话令牌命中就拒绝发送，并在 finish 里说明 |
| 条数/字数 | 一任务最多 10 条文本、单条 ≤500 字、最多读 5 个会话/发 3 个目标 |
| 频次 | 每人按上面档位；全局每天 200 个事务台上限；同一来源同时只允许 1 个 |
| 审计 | 每个事务台写 `state/cross-tasks.jsonl`（来源/请求人/读/发/摘要/原因），并进活动日志 |

## 4. 改动文件

- 新增 `src/cross-task.js`（纯逻辑）：配置归一、请求校验、peek 裁剪、事务台提示词、审计行。
- `src/bridge.js`：
  - 配置默认值 `socialV2.crossTask` + `socialV2.tools.crossTask`；主人私聊唤醒提示多一行【跨会话】。
  - 新端点：`POST /api/socialV2/cross-task|cross-peek|cross-send|cross-finish`。
  - 事务台状态机：`crossTasks` / 一次性 token / TTL / `finishCrossTask` / `createCrossSession`。
- `src/mcp-snowluma-safe.js`：注册 4 个工具（受 `crossTask` 开关控制）：
  `qq_cross_task`、`qq_peek_conversation`、`qq_cross_send`、`qq_cross_finish`。
- 配置：`config.json` / `config.example.json` 增加 `socialV2.crossTask`。
- 测试：`scripts/test-cross-task.mjs`（已登记 audit）。

## 5. 语音语速 +6%

- `voices/hikari-cn/voice.json`、`voices/hikari-cn2/voice.json` 加 `"speed": 1.06`。
- 修 `voxd/engine/gsv.py`：GSV caps 标记 `rate_control=True`——GSV 的 `speed_factor` 是**原生变速（不变调）**，
  不改的话 `api._one` 还会再按 `pl.rate` resample 一次，等于变速两次。
- 备份：两个 voice.json + gsv.py 都有 `.bak-2026-11-05`。
- 实测同一句「测试一下语音。」：**2260ms → 2160ms（约 +4.6%）**，音色/音高不变。

## 5.1 语音韵律：停顿分组与间隙（社区学习后微调，2026-11-05）

社区（dsh-gpt-sovits / GPT-SoVITS 文档）主要结论：
- api_v2 默认 `text_split_method=cut5`：会在**每个标点**（含逗号）后切段，并给每个切点塞 `fragment_interval=0.3s` → 逗号处也硬停 0.3 秒，听感机械、间隙偏长且均匀；
- 更自然的做法是「引擎少插停顿，按标点自己分配」：`fragment_interval=0` + 插件按句/逗号插入不同长度静音；只按句号切（cut3）时逗号处由模型自己处理韵律。

本次**不改语速**，只做两处小改：
1. `voxd/voices.py` + `voxd/engine/gsv.py` 支持两个可选字段（voice.json 不写就保持原行为）：
   - `text_split_method`（cut0~cut5）
   - `fragment_interval`（切点静音秒数）
2. `hikari-cn` / `hikari-cn2` 的 voice.json 设为：
   `"text_split_method": "cut3"`、`"fragment_interval": 0.25`。
   —— 只在**句号**处分段（逗号交给模型），句间留 0.25s；语速仍是 1.06。

实测（46 字、两句）：
- `fragment_interval=1.2` 时 13180ms，回到 0.25 时 11280ms（参数确实生效，间隙可控）；
- 短句「测试一下语音。」2110ms（与之前同一量级，语速未变）。
- 试听样本：`state/voice-packs/voice-local/logs/sample-prosody-short.wav`、`sample-prosody-multi.wav`。
- 想再调：只改 voice.json 的 `text_split_method`（cut3/cut5/cut0）和 `fragment_interval`（0.15~0.35），重启语音包即可；不要动 `speed`。

## 6. 生效方式

- 桥接与语音包已重启并生效（`8765/9880` 在跑）。
- **MCP 工具是 DSH 启动时注册的，需要重启一次 DSH 才会出现。**
  （同时下次 DSH 启动会自动执行「启动准备」：QQ/SnowLuma → B站 → 语音包。）

## 7. 验证

```text
node scripts/test-cross-task.mjs        # 校验/裁剪/提示词/审计 + 接线静态检查
node scripts/test-audit.mjs             # 全量审计（已登记）
```

真机（桥接重启后）：
- 空读范围 → `400 至少要给一个要读的会话（readKeys）`；
- 群会话发起 → `400 跨会话任务目前只允许主人发起`；
- 非白名单私聊当 readKey → `400 不能读取这个会话…`。

## 8. 已知限制 / 后续

- 只支持纯文本；图片/语音/文件转发（需要下载再上传）不在本次范围。
- 「该不该帮/转不转/转多少」由小光在事务台里按提示词自审（内容隐私、关系、好感度）；桥接只保留白名单、敏感信息、条数等硬闸。
- 白名单不限次按「个人是否在白名单」判断（`allow.private`）；群成员默认按好感度档位（≥60 每天 5、其他 3）。
- 次数按请求人记在 `state/cross-task-daily.json`，跨天自动重算；桥接重启不清零。
- 事务台会话用的是同一个 qq-chat-v2 preset，所以工具列表里仍有普通 QQ 工具；它们会因 token 不匹配返回 403，提示词已要求不要试。
- 事务台会话目前不做 token/费用归属到具体 QQ 会话（只在 DSH 侧普通计费）；需要的话可以下一版接 token 账本。
- 「整理多群信息私发」已可用，但读的是各会话 recentMessages 最近片段（每会话最多 200 条），不做全量归档检索。

