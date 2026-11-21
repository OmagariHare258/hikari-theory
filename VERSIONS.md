# 版本与兼容性

这套东西是在一组具体版本上验证的。换版本不一定坏，但出问题时先对一下这里。

## 验证过的环境

| 组件 | 版本 | 说明 |
|---|---|---|
| 操作系统 | Windows 11 x64 | 脚本是 PowerShell 7 写的，其他系统需要改动 |
| DSH | 44.7.0 | 桌面端；不同大版本的会话/事件接口可能有差异 |
| Node.js | v24.15.0 | 文档建议 20+；低版本可能缺 API |
| SurfCore（上游） | v0.8.8，commit `0deb826` | 补丁基准 |
| SnowLuma | 2.4.0 win32-x64 | OneBot 网关；其他版本接口名可能不同 |

## 补丁基准

`patches/surfcore-local-updates.patch` 和 `patches/surfcore-tracked-changes.patch` 都是对着 SurfCore `0deb826`（v0.8.8）生成的。

- 全量补丁：`surfcore-local-updates.patch`，包含桥接、MCP 工具、语音、B站、跨会话记忆、隐私层等；**装整套用这个**。
- 核心子集：`surfcore-tracked-changes.patch`，只保留原创核心逻辑；全量补丁冲突时的退路。
- 应用顺序：**先打补丁，再复制 `patches/new-files/`**；反了会报 "does not exist in index"。
- 优先直接 `git apply --whitespace=nowarn`；失败再 `--3way`；仍失败则手工移植 `new-files/`。

## 外部依赖

仓库本身不包含这些，需要单独准备：

| 依赖 | 用途 | 是否必须 |
|---|---|---|
| DSH | 模型会话、工具、插件宿主 | 必须 |
| SurfCore | QQ 会话调度、发送、工具面 | 接 QQ 必须 |
| SnowLuma | QQ ↔ OneBot 网关 | 接 QQ 必须 |
| 机器人 QQ 号 | 收发消息 | 接 QQ 必须 |
| 模型 provider / API key | 实际推理 | 必须 |
| 本地 TTS / 语音包 | 语音能力 | 可选 |
| B 站相关工具 | 动态、评论、私信 | 可选 |

## 已知版本敏感点

- DSH 的 MCP 工具列表在启动时加载，新增工具后需要重启 DSH 才会出现。
- SnowLuma 不同版本的 OneBot 动作名和字段可能不同（例如临时会话的 `group_id`）。
- SurfCore 的配置字段在版本间有增减，照抄旧配置可能缺项；以当前仓库的 `examples/` 和上游文档为准。
- 补丁里涉及的函数名、事件名依赖上游实现，升级后可能对不上。
