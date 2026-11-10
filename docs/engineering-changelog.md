# 工程改动清单（SurfCore 侧原创部分）

> 对应《橘小光理论》第四部分。只保留**本方案的原创工程改动**；插件自带、无足够独创性的功能不在本清单内。
> 所有真实账号、QQ 号、群号、令牌、路径均已脱敏。
> 
> 说明：SurfCore 上游本身已经提供了会话调度、唤醒、发送等主干能力；本清单记录的是在它们之上做的**增量改动与边界处理**，不是重写。

---

## 1. 总览

| 区域 | 改动 | 核心内容 |
|---|---|---|
| 桥接自愈 | `src/bridge.js` | 忙碌看门狗、无损重置补记、租约/提交超时 |
| 跨会话事务台 | `src/cross-task.js`（新增） | 校验、配额、提示词、双轨称呼、审计、隐藏执行 |
| 发送与回复 | `src/bridge.js` | 群临时会话回复（带 group_id）、网络图片发送 |
| 工具层 | `src/mcp-snowluma-safe.js` | `qq_send_image`、跨会话三工具、内部工具不解释机制 |
| B站活性 | `src/bili-dynamics.js`、`src/bili-api.js` | 10 分钟抖动轮询、指数退避、内部重试（抗 -352） |
| 文档 | `docs/` | 跨会话协议、案例 |

---

## 2. 桥接自愈（src/bridge.js）

### 2.1 忙碌标记与看门狗

- **问题**：会话长期"会话繁忙，暂存唤醒原因"，QQ 侧表现为长时间不理人。
- **根因**：忙碌由三个标记决定（`pendingWakeKeys` / `promptQueues` / `v2TurnStartAt`），正常依赖 `turn/end` 清除；事件流断线或工具挂起时标记僵住。
- **实现**：
  - `startBusyWatchdog()`：每 60s 扫描，连续忙超过阈值（默认 5 分钟）→ 自动 `resetSessionContext` 并写补记。
  - 唤醒租约 10 分钟（可配）；回合租约 8 分钟；重连恢复的回合起始时间回拨 5 分钟。
  - `ensureSession` 90s、`sessions.prompt` 120s 超时，串行队列不会永久 running。
- **验证**：制造忙标记 → 阈值后自动重置，日志出现对应记录，后续消息恢复正常。

### 2.2 无损重置（补记）

- `state/reset-memos.json`；重置前写「最近 20 条消息 + 收尾摘要 + 活跃话题 + 群友印象」（上限 3000 字，24h）。
- `buildWakePromptV2` 注入【上次会话补记】并立即删除（一次性）。
- 手动重置、看门狗、控制台重置共用 `resetSessionContext(key,{reason})`。

### 2.3 串行 prompt 队列

- 每会话一条队列（`promptQueues`），保证 turn 顺序；失败/超时释放 `running`。

---

## 3. 跨会话事务台（src/cross-task.js，新增）

- 纯函数模块：配置归一化、请求校验、每日配额、peek 裁剪、提示词、审计行。
- 规则：读 ≤5 会话、发 ≤3 目标、单任务 ≤10 条、TTL 10 分钟、同来源并发 1、全局 200/天。
- 内容边界默认放开、由角色自审；敏感信息（手机号/证件/地址/令牌）硬拦截。
- **隐藏执行**：会话不命名、结束立即归档（`keepSessionMs=0`）；默认不把摘要发到聊天（`reportToChat=false`）。
- **双轨称呼**：提示词显示「群名（group:群号）」/「昵称（private:QQ）」；对外只用名字，工具参数仍用 key。
- **鉴权修正**：中间件原本只认活跃会话 token，事务台 token 一律 403；新增 `crossTokenCheck` 放行（handler 内仍校验 key+token）。

---

## 4. 发送与回复

### 4.1 群临时会话回复

- 入站私聊若带 `group_id`（群临时会话），记录来源群；回复时自动带 `group_id`，避免 QQ 显示发送失败。

### 4.2 好友之间转发\n\n- 私聊发送工具原先只认当前会话的令牌，导致"把内容转给另一个好友"直接报令牌无效。\n- 现在从令牌反查发起会话，主人/白名单私聊可向 QQ 好友发送；`allow.friendTargets` 控制开关（默认关闭）。\n- 事务台的发送目标同步支持白名单外的好友（默认任意请求人；群聊发起不额外拦截，可再收紧）。\n- 新增只读工具 `qq_list_send_targets` 与唤醒提示词【可发送对象】，解决"名单翻不到/只有几个熟面孔"的自我认知错误。\n- 修复转述时"谁说的"被搞错：peek 每条加 `self` 字段 + 提示词明确"请求人 ≠ 内容来源"，避免把自己刷到的内容写成请求人说的。\n- 详见 `docs/FRIEND-FORWARD.md`。\n\n### 4.3 网络图片发送

- `POST /api/socialV2/send-image`：支持图片直链、数组、或 `query`（Bing 图片搜索）；桥接内下载 + 直链/网页 og:image；只收 PNG/JPEG/GIF/WebP；复用发送限速与额度。
- 人格规则：要看角色照片时**不发表情包**；发 1–2 张、配一句话、找不到就直说。

---

## 5. 工具层（src/mcp-snowluma-safe.js）

- 新增 `qq_send_image`（url/query）。
- 新增跨会话四工具：`qq_cross_task` / `qq_peek_conversation` / `qq_cross_send` / `qq_cross_finish`。
- 工具描述加入"内部工具不解释机制"（避免对用户说"事务台/令牌"）。
- 注册期开关过滤，减少上下文 token。

---

## 6. B站 作息与活性\n\n- 生物钟支持工作日/周末两套窗口（`night.profiles`）：工作日中午 12:00–14:00 一次，周末 08:00–10:00 / 11:00–13:00 / 20:00–23:00 任选两次；详见 `docs/BILI-SCHEDULE.md`。\n- 修复 `whale-night.mjs` 把已归一化窗口再传给排程器、导致窗口回退成默认 `20:00–24:00` 的问题（改为传原始字符串窗口）。
- 评论区分享在新号上会被判 `state=17`（仅自己可见），临时把 `share.via` 改为 `dm`（只发主人私信），等账号养稳再切回。
- 私信支持双向关注好友像 QQ 一样正常聊：好友额度 10 条/人/天、300 字，非好友仍 3 条/200 字；详见 `docs/BILI-DM-FRIENDS.md`。
- 养号期把评论/搭话频率降到 5/2/10，并加每日 `bili-state-watch.ps1` 哨兵巡检；详见 `docs/BILI-WARMUP.md`。\n\n### 6.1 动态（src/bili-dynamics.js / src/bili-api.js）

- 动态轮询 180s → 600s，加随机抖动。
- 失败指数退避（最长 30 分钟），单次内部最多重试 4 次（2/4/8s）。
- 目的：抗 `-352` 风控；实测重试可拿到数据。

---

## 7. 文档

- `docs/guides/CROSS-TASK-RULES.md`：事务台协议（隐藏、双轨、权限、审计）。

---

## 8. 关键配置示例

见 `examples/config.example.json`（脱敏）。

---

## 9. 验证方式

- 每项改动至少包含一个可复现验证：日志关键字、控制台 API、或状态文件字段。
- 角色卡改动：组合字数、关键词校验、跑一次真实对话。
- 工程改动：重启后看启动日志、制造一次失败路径、确认自愈。


## 2026-11-06 批次（好友转发 / B站作息 / 梗与时效 / 反模板）

- **QQ 好友转发**：允许发起人读自己的会话、发给主人、好友间互转（`allow.friendTargets` / `allow.friendPrivate`）；事务台提示词改为"结构化内容由小光判断逐字转写还是复述"。
- **B站 作息**：工作日中午 12–14 一次、周末 8–13/20–23 两次（`night.profiles`）；分享通道临时切 `dm`（避开评论 state=17）；私信支持互关好友像 QQ 一样聊；新增 `contacts` 命令查互关/关注/粉丝。
- **梗与时效**：唤醒提示加【梗百科】（`search_meme_wiki`）与【信息时效】（旧闻不称"刚刚"）；状态层赛况标"旧闻·X天前"并带下一场倒计时。
- **反模板**：人格卡与【反AI味】禁止记账式固定收尾（"记下了/回来收/可记着呢"）与固定反问。
- 新增脚本 `scripts/bili-state-watch.ps1`（养号期每日巡检评论是否公开）、`docs/BILI-WARMUP.md`、`docs/BILI-DM-FRIENDS.md`、`docs/BILI-SCHEDULE.md`。

## 2026-11-10 全量本地同步

- 导出本地工作区全部 tracked 改动：patches/surfcore-local-updates.patch（约 2142 行改动）。
- 同步全部未跟踪新增文件到 patches/new-files/（B站登录保持、cookie 刷新、contacts、语音/好感模块、测试与案例）。
- 同步最新人格卡到 character/persona.md。
- 个人配置（config.json）、state、凭据、真实 QQ/群号均已排除或脱敏。
