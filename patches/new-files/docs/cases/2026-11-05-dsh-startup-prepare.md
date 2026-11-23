# 打开 DSH 自动准备：QQ（含 SnowLuma）→ B站 → 语音包

日期：2026-11-05

## 1. 需求

用户原话：

> 打开 dsh 时自动连接 qq、b站、拉起语音包等准备行为。

目标：DSH 一打开（插件加载）就把日常要用的东西按顺序拉起来，不用每次手动点「一键启动」或去语音页点启动。

## 2. 改之前

- DSH 插件启动时会：按开关启动 B站 生物钟（`startSchedulerNow`）、可能自动启动 QQ 桥接（`bridge.autoStart`），
  但 **语音包不会自动启动**；SnowLuma 也只在「一键启动 / 启动QQ」按钮里按需打开。
- 用户要完整跑起来，得手动去概览点「一键启动」并勾语音，或者去语音页点「启动语音包」。
- 开机时的 `start-all.ps1` 只管进程级启动（QQ/SnowLuma/DSH/桥接），语音只报告端口，不负责拉起。

## 3. 改动

### 3.1 配置

- `~/.dsh/surfcore/config.json` 新增 `startup` 段（默认值，不写也存在）：

```json
"startup": { "enabled": true, "components": ["qq", "bili", "voice"], "voicePack": "voice-local", "delayMs": 8000 }
```

- 归一（`plugins/surfcore/lib/store.js` 的 `normalizeStartupConfig`）：只认 `qq/bili/pet/voice`，去重；
  空数组回默认三项；`voicePack` 只认 local/cloud；`delayMs` 夹 3~120 秒。

### 3.2 插件（`plugins/surfcore/lib/index.js`）

- 插件激活时 `scheduleStartupPrepare()`：默认等 **8 秒**（等 DSH/网络稳定）后跑 `runStartupPrepare()`。
- `runStartupPrepare()` 复用了「一键启动」的 `startComponent` / `launchStatus`：
  - 固定顺序 **QQ → B站 → 语音**（语音包由桥接托管，必须桥接就绪）；
  - 每个组件先看状态，**已在跑就跳过**（幂等）；
  - QQ 就绪额外看 SnowLuma 是否连上：桥接在跑但 SnowLuma 没连 → 仍会走一次「打开 SnowLuma」；
  - QQ 启动后最多等桥接 45 秒，再启动语音包；
  - 结果写插件日志（逐项 ✓/✗ + 失败原因）。
- 新接口：`GET /startup`（配置 + 上次结果 + 是否在跑）、`POST /startup {action:"run"}`（手动立即准备）。
- 销毁时清掉启动定时器。

### 3.3 设置页（`plugins/surfcore/lib/client.js` 概览「启动」卡）

- 新增「DSH 启动准备（自动）」分组：
  - 开关（写 `unified.startup.enabled`，随底部保存；关掉后下次 DSH 启动不再自动准备）；
  - 「上次准备：时间 + 各项 ✓/✗」；
  - 「立即准备一次」按钮（不等下次启动，现在就跑）。

### 3.4 顺带修复：语音包其实一直拉不起来（2026-11-05 实测）

做自动准备时在真机上试「拉起语音包」，连试两次都失败，挖出两个独立问题：

1. **`run.bat` / `gsv.bat` 被写坏**：旧文件里的 `\v` `\t` `\a` 被当成转义字符写成了控制字符
   （`logs\voxd.out.log` 变成 `logs<VT>oxd...`、`%CD%\vendor` 变成 `%CD%<VT>endor`），
   cmd 直接报「文件名、目录名或卷标语法不正确」。已用干净 CRLF 重写两个脚本（保留 `.bak-2026-11-05`）。
2. **启动逻辑误判 detached 启动器**：本地包 `run.bat` 用 `start "" /b pythonw ...` 拉起服务后自己立刻 `exit 0`，
   而 `src/voice-packs.js` 的 `start()` 循环看到「进程已退出」就 `break`，报 `VOICE_START_EXITED`；
   实际 voxd 1~3 秒后就监听了。
   修法：`exit 0` 继续等端口（只有非 0 才提前失败）；最终端口仍未起来时按「超时」而不是「进程退出」报。

修复后实测：`POST /api/voice/packs/activate` **5.1 秒返回 ok**（以前秒失败），
随后 9880 加载完成，`engineUp=true`，`hikari-cn` 合成测试通过（wav 2.26s / 4.20s）。

## 4. 生效 / 边界

- **下次 DSH 启动时生效**（插件代码在 DSH 启动时加载；当前会话里改完要重启一次 DSH）。
- 尊重原有开关：QQ / B站 的「启动开关」关掉时，对应组件不会被自动准备（`startComponent` 里已有的判断）。
- SnowLuma 自动打开仍受 `snowluma.allowLaunch` 控制（默认关；本机已是 true）。
- 语音包只在「桥接已就绪」时才启动；桥接 45 秒没起来会记一条日志，语音可能失败，下一次启动会重试。
- 重复触发安全：`startupPrepareRunning` 防并发；`startup` 定时器在插件销毁时清理。

## 5. 验证

```text
node scripts/test-startup-prepare.mjs      # 配置归一 + 接线契约 + detached 启动器回归（静态）
node plugins/surfcore/scripts/test-voice-packs-default.mjs
node scripts/test-audit.mjs                # 全量审计（已登记）
node --check plugins/surfcore/lib/index.js plugins/surfcore/lib/store.js plugins/surfcore/lib/client.js src/voice-packs.js
```

当前机器上 `readUnified()` 已能返回归一后的默认值：
`{ enabled: true, components: ['qq','bili','voice'], voicePack: 'voice-local', delayMs: 8000 }`。
真机端到端要等下次 DSH 启动（插件重新加载）后，在插件日志里看 `[启动准备] 开始/完成` 与概览「上次准备」。

