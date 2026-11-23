# 语音按好感度分档：≥60 解锁、<60 大幅限频

日期：2026-11-05

## 1. 需求

用户原话：

> 开启对好感度 60 以上解锁完全语音功能，好感度 60 以下频率大幅减少。无论何时只有在需要发语音时才发语音。

拆成三条：

1. 好感度 ≥ 60：语音功能完全可用（私聊/群聊都能发，不再只限主人）；
2. 好感度 < 60：不是完全禁掉，而是**频率大幅减少**（冷却 + 每日上限 + 对方先开口）；
3. 任何分档下：语音只在确实需要时发，默认文字，不为「像真人」硬发。

## 2. 现状（改之前）

- QQ 语音只有 `socialV2.voice.trigger.who` 三档：`owner`（默认）/ `anyone` / `list`，
  与好感度完全无关；好感度只用于人格卡日常层的语气提示。
- 主人的好感度是 100（下限 75），所以「仅主人」等于「只对 100 分的人开」；
  59 分的朋友（群友D）、54 分的群友E在私聊里永远听不到语音。
- 提示词里没有「什么时候该发语音」的约束，只有「工具可用/不可用」。

## 3. 改动

### 3.1 新模块 `src/voice-affection.js`

- 读 `characters/<id>/affection.json`（`state/tools/affection.ps1` 生成；带 mtime 缓存）；
  - 主人按 `ownerFloor`（默认 75）兜底；
  - 名单外的人按 `unknownScore`（默认 10，即「陌生人」）处理。
- 判定：`score ≥ fullAt(60)` → `full`；`< fullAt` → `low`（冷却 + 每日上限内）或 `blocked`。
- 记账：`state/voice-affection.json`（每人 `lastAt` + 当天条数）；跨天清零、冷却保留；坏文件自动重置。
- 纯函数，单测覆盖（`scripts/test-voice-affection.mjs`）。

### 3.2 桥接（`src/bridge.js`）

- `voiceCfg()` 增加 `affection`（`socialV2.voice.affectionGate`）；`trigger.who` 增加 `affection` 模式。
- `voiceTriggerBlock()` 重写：
  - `affection` 模式：≥门槛直接放行（不再看「是不是主人」）；<门槛走低频路径；
  - `owner` / `anyone` / `list` 模式：保留原规则，门槛只作为**额外低频限制**（不会放行被旧规则挡住的人）；
  - 低频路径要求「他最近 10 分钟内说过话」，否则提示等他先开口；
  - 顺手修了 `list` 分支引用未定义变量 `last` 的旧 bug。
- 发送成功后在 `sendVoiceForV2()` 里记一笔好感度语音账（`noteVoiceSentForAffection`）。
- 提示词：`voiceStatusLine(key)` 现在带当前对话对象的好感度与策略（≥门槛=已解锁、默认文字；
  <门槛=极少用、给了具体额度），并固定追加「语音是强表达，不是每条都发」。
- `/api/voice/rules` GET/POST 增加好感度门槛字段；保存时统一走 `normalizeVoiceAffection`。

### 3.3 设置页（`plugins/surfcore/lib/client.js`）

「语音 → 触发规则」新增：

- 触发模式新增「好感度 ≥60（推荐：解锁）」；
- 「按好感度设语音门槛」开关 + 门槛分 + 低于门槛的冷却小时数 / 每日上限 / 名单外默认分（只读提示）；
- 说明文案写清：低于门槛要等对方先开口、无论多少分都只在需要时发语音。

### 3.4 本机配置

`config.json` → `socialV2.voice`：

```json
"trigger": { "who": "affection" },
"affectionGate": { "enabled": true, "fullAt": 60, "lowCooldownHours": 6, "lowMaxPerDay": 2, "lowWindowMinutes": 10, "unknownScore": 10 }
```

（`tts.enabled` / 总闸保持原来的开。）

## 4. 验证

```text
node scripts/test-voice-affection.mjs          # 分数/解锁/冷却/每日上限/跨天/mtime 缓存
node scripts/test-audit.mjs                    # 全量审计（已登记新测试）
node --check src/bridge.js && node --check src/voice-affection.js
```

真机（桥接重启后）：

- 主人私聊 dryRun：`HTTP 200 ok=true`（100 分 → 完全解锁）；
- 群聊 dryRun（重启后还没人说话，按名单外 10 分＝陌生人）：`HTTP 403 好感度 10 低于 60：语音要少用，等他先开口再回`；
- `GET /api/voice/rules` 返回 `triggerWho=affection / affectionFullAt=60 / ...`，POST 往返一致；
- `GET /api/socialV2/prompt?key=private:10000001` 里能看到
  `【语音·好感度】sensei 好感度 100/100（最喜欢） ≥ 60：语音已解锁…` 与 `【语音原则】…不是每条都发`。

## 5. 边界 / 风险

- 「需要不需要发语音」模型侧仍靠提示词约束；代码只保证「不该发的时候发不出去」。
- 好感度脚本每天 23:50 才更新一次（`SurfCore-Affection` 计划任务），所以门槛按**昨天/当天已算好的分**生效；
  当场聊天不会立刻改变分数。
- 群聊里「说话人」= 最后一条入站消息的发送者；如果她回的是别人，分数按那个人算（不是按群）。
- 操作者手动试发（控制台/CLI）不受好感度门槛限制（方便调试），仍受白名单/频率/审计约束。
- 重启桥接后 `voiceLastSpeaker` 是空的：低频路径会先要求「等他先开口」，这是预期行为。

