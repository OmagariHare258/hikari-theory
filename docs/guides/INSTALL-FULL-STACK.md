# 完整安装清单（DSH + SurfCore + SnowLuma）

目标：从零装出「能接 QQ、有跨会话记忆、多窗口注意力、隐私层、管理工具」的整套环境。

## 0. 先决条件

- Windows 10/11 x64、PowerShell 7；
- Node.js 20+（推荐 24）；
- Git、GitHub API 可达；
- DSH 能正常建会话、能对话；
- SnowLuma 已登录机器人 QQ，OneBot HTTP/WS 已开；
- SurfCore 基准 v0.8.8 / `0deb826`。

## 1. 一条命令（推荐）

```powershell
pwsh -File scripts/bootstrap.ps1
```

脚本会：

1. 检查环境、clone/复用 SurfCore；
2. 检出 `0deb826`；
3. **先打全量补丁** `patches/surfcore-local-updates.patch`（direct → `--3way` → 核心子集兜底）；
4. **再复制** `patches/new-files/`（已存在跳过）；
5. `npm install`；
6. 生成 `config.json` 和 `state/privacy.json` 骨架。

跑完按屏幕上的 1–7 步做人工部分。

## 2. 手动步骤（脚本失败时）

```powershell
git clone https://github.com/Mieksido/surfcore.git surfcore
cd surfcore
git checkout 0deb826
git apply --whitespace=nowarn ..\hikari-theory\patches\surfcore-local-updates.patch
# 若失败：git apply --3way ...；仍失败：改用 surfcore-tracked-changes.patch（功能会少）
Copy-Item ..\hikari-theory\patches\new-files\* . -Recurse -Force   # 已存在跳过
npm install
Copy-Item ..\hikari-theory\examples\config.example.json config.json
New-Item -ItemType Directory -Force state | Out-Null
Copy-Item ..\hikari-theory\examples\privacy.example.json state\privacy.json
```

**顺序不能反**：先复制 `new-files` 再打全量补丁，会报 `does not exist in index`。

## 3. 配置

`config.json` 必填：

- 机器人 QQ；
- SnowLuma HTTP/WS 地址与 token；
- DSH 本地地址/端口；
- `allow.groups` / `allow.private` 白名单；
- 控制台 token（没有就生成随机串）。

`state/privacy.json`：

```json
{"terms":["你的真实姓名","你的学校","C:\\Users\\你的用户名"]}
```

- 只在本机，不要提交仓库；
- 群发命中会拒绝，共享记忆/摘要会 `[已隐去]`；
- 通用模式（手机号、身份证、邮箱、`C:\Users\...`）不需要写词表。

## 4. 起桥接 + 重启 DSH

```powershell
node src/bridge.js
```

确认日志：

- SnowLuma 已连接；
- DSH 已就绪；
- 没有持续报错。

新增的 MCP 工具（跨会话读取、隐私、管理工具）在 DSH 启动时加载，**装完要重启一次 DSH**。

## 5. 验收

用另一个 QQ：

1. 私聊发一句，能回；
2. 群里 @ 她，能回；
3. 主人私聊问「列一下所有会话」，她应该能调 `qq_list_conversations`；
4. 主人私聊说「把群里最近几条读一下」，能读（成员校验通过）；
5. 发一条含 `state/privacy.json` 示例词的群消息，应被 `PRIVACY_BLOCK` 拒绝；
6. 重启桥接/DSH 后，共享记忆和隐私词表还在。

## 6. 可选能力

- 跨会话记忆：`docs/guides/SHARED-MEMORY.md`
- 多窗口注意力：`docs/guides/MULTI-WINDOW.md`
- 隐私：`docs/guides/PRIVACY.md`
- 管理工具（QQ 里改人格卡）：`docs/guides/ADMIN-TOOLS.md`
- 共享大脑方案：`docs/guides/SHARED-MIND.md`
- 周调优：`docs/guides/WEEKLY-TUNING.md`

## 7. 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| `does not exist in index` | 先复制 new-files 后打补丁 | 换干净基准，按「补丁→new-files」顺序 |
| `patch does not apply` | 上游版本不对 | 检出 `0deb826`；或手工移植 |
| 工具不出现 | DSH 没重启 | 重启 DSH |
| 群发被隐私拦截 | 词表命中 | 编辑 `state/privacy.json` 或改句子 |
| 写不进人格卡 | 只有主人私聊权限 | 在主人私聊里用 `admin_persona_patch` |
