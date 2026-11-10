# AGENTS.md — 给执行安装的 AI 的说明

你是一台新电脑上的 AI 助手，读到了这个仓库。你的任务：按下面的阶段把环境搭起来，让一个 LLM 角色能在 QQ 上跑。

## 总规则

1. **先读文档再动手**：README → BOOTSTRAP.md → VERSIONS.md → 本文件 → PLAYBOOK 相关章节。
2. **不要编造**：不知道版本、路径、端口时，查（命令、日志、问用户），不要猜一个值填进去。
3. **凭据只向用户要**：QQ 号、token、API key、群号都由用户提供，写进本机配置即可。不要把凭据写进仓库、issue、日志摘录或聊天记录。
4. **每阶段先验证再继续**：验证失败就停在这一阶段排查，不要带病往下走。
5. **改上游文件前先备份**：至少 `git stash` 或复制一份，能回退。
6. **不要做破坏性操作**：不删除用户已有目录、不改系统级配置、不开公网端口，除非用户明确要求。
7. Windows 环境用 PowerShell 7；其他系统把命令换成对应的 shell 写法。

## 阶段 0：环境探测

依次检查并记录：

```powershell
$PSVersionTable.PSVersion
node -v
git --version
Get-Command gh -ErrorAction SilentlyContinue
# DSH 是否安装（路径以用户环境为准）
Test-Path "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe"
# 网络：GitHub API 是否可达
try { (Invoke-WebRequest 'https://api.github.com' -TimeoutSec 10 -UseBasicParsing).StatusCode } catch { 'github api unreachable' }
```

**判定**：
- 缺 Node/Git → 告诉用户装什么，等装好再继续。
- GitHub 不可达 → 让用户把仓库下载成 zip 放到本机，从本地目录继续。
- DSH 没装或打不开 → 先解决 DSH，装别的没用。

**输出**：给用户一段环境摘要（已有什么、缺什么、下一步要做什么）。

## 阶段 1：获取仓库

优先 `git clone https://github.com/OmagariHare258/hikari-theory.git`。

如果 clone 失败（连接重置/超时）：
- 试 `gh repo clone`；
- 或让用户从网页下载 zip 并解压；
- 或从镜像拉取（例如 `https://ghfast.top/https://github.com/...`），但镜像只用于获取，不要向镜像提交凭据。

**验证**：仓库根目录能看到 `README.md`、`AGENTS.md`、`patches/`。

## 阶段 2：准备 SurfCore

```powershell
# 上游仓库（版本见 VERSIONS.md）
git clone https://github.com/Mieksido/surfcore.git surfcore
cd surfcore
git log -1 --oneline
```

- 目标基准是 `v0.8.8`（commit `0deb826`）。如果当前 tag 不同，先 `git checkout v0.8.8`，没有 tag 就 `git checkout 0deb826`。
- 把仓库的 `patches/new-files/` 按相对路径复制进 surfcore。
- 尝试打补丁：

```powershell
git apply --3way ..\hikari-theory\patches\surfcore-tracked-changes.patch
```

**验证**：
- 补丁有没有冲突？有冲突就停下来，把冲突文件列给用户，并说明可以手工移植 `patches/new-files/` 里的核心模块（`src/cross-task.js` 等）。
- 然后装依赖：`npm install`。失败先看 Node 版本和网络。

## 阶段 3：写配置

1. 复制 `hikari-theory/examples/config.example.json` 到 surfcore 的 `config.json`（如果已有配置，不要覆盖，先备份）。
2. 向用户收集并填入：
   - 机器人 QQ 号
   - SnowLuma HTTP/WS 地址与 token
   - DSH 本地地址（默认回环）
   - 允许的群/私聊
   - 控制台 token（没有就生成一个随机串）
3. 提醒用户：`allowAllWhenEmpty=true` 会放行所有私聊/群消息，不想这样就把白名单填上。

**验证**：JSON 能被解析；必填字段不为空；不要出现真实 token 被打印到终端历史里（提醒用户）。

## 阶段 4：角色与状态层

**先确认一件事：本仓库的橘光只是示例，用户可以换成自己的角色。** 不要默认复刻橘光，也不要往用户的角色里混入橘光的设定。

如果用户只给一句话或少量描述，按 `docs/CHARACTER-BUILDER.md` 帮忙扩写：先复述你理解到的设定并确认；再分 2–3 轮问关键信息（身份/世界、性格目的、关系、说话样例、边界）；能扩写的结构和行为给候选方案让用户挑；最后输出完整九层卡 + 状态层样例。扩写只动结构与行为，不编造用户的真实经历、身份或私人信息。

四种情况：

1. **用户给了角色卡/设定文档**：按九层结构整理，保留用户的事实、关系和台词，别改设定。
2. **用户只给了一段描述**：向用户问清这几项——名字、身份/年龄、性格目的、说话方式（给 2 个例子）、和用户的关系、不喜欢的行为；然后按 `character/ROLE-TEMPLATE.md` 补全。
3. **用户没有角色**：可以先用 `character/persona.md` 跑通链路，但要明确告诉用户这是示例，之后再换。
4. **用户想改示例**：可以，但把名字、世界观、关系、口癖全部替换，不要留半套橘光。

具体步骤：

1. 在 SurfCore 的角色目录创建角色（参考其文档/控制台；一般是一个目录加 id/名称）。
2. 角色卡正文按九层写（参考 `character/persona.md` 的结构，`character/ROLE-TEMPLATE.md` 是空白版）。
3. 复制 `character/persona.daily.sample.md` 作为状态层样例，告诉用户后续由脚本/手动刷新。
4. 检查注入预算：角色卡 + 状态层组合字数不超过配置里的 `role.maxInjectChars`。

**验证**：组合字数不超限；抽 3 个常见场景，回复风格符合用户的角色（不是橘光）。

## 阶段 5：网关与 QQ（需要用户操作）

你不能替用户扫码/登录 QQ。你需要：
1. 告诉用户安装并登录 SnowLuma（见 BOOTSTRAP.md 第 3 步）。
2. 用户完成后，验证 OneBot：

```powershell
# 端口与 token 以用户配置为准
Invoke-RestMethod "http://127.0.0.1:<port>/get_login_info?access_token=<token>"
```

**验证**：返回机器人 QQ 号；不是用户主号。

## 阶段 6：起桥接并验证链路

1. 前台启动桥接，盯着日志：

```powershell
node src/bridge.js
```

2. 确认日志出现：
   - 连上 SnowLuma（可能是 `已连接` / `SnowLuma 已连接`）
   - DSH 就绪（`DSH 已就绪`）
   - 没有持续报错
3. 让用户用另一个 QQ 给机器人发消息，确认有回复。
4. 查控制台/状态接口（端口以配置为准）确认连接状态。

**失败处理**：见文末速查表。

## 阶段 7：稳定性（建议）

- 确认看门狗/补记/超时配置已开（参考 `docs/engineering-changelog.md` 的配置示例）。
- 验证方式：手动停一次 DSH 再恢复，看桥接能否重连、消息能否恢复。
- 如果用户需要开机自启，参考 `scripts/start-all.ps1` 改路径，做成幂等启动。

## 阶段 8：可选能力

按用户需要，再开：
- 发图：见 PLAYBOOK §5；需要工具与规则。
- 语音：见 PLAYBOOK §6；需要本地 TTS/语音库。
- 跨群事务台：见 `docs/guides/CROSS-TASK-RULES.md`；默认隐藏执行。
- B 站功能：需要额外凭据与工具，注意频率风控。

**注意**：DSH 的 MCP 工具列表在启动时加载，新增工具后要重启 DSH 才会生效。

## 验收清单

- [ ] 私聊能收发
- [ ] 至少一个群能收发
- [ ] 回复风格符合角色卡
- [ ] 日志无持续报错
- [ ] 重启桥接/DSH 后能恢复
- [ ] 配置里没有把凭据写进仓库
- [ ] 用户知道去哪里改角色、改状态、看日志

## 失败速查

| 现象 | 先查 | 处理 |
|---|---|---|
| 桥接起不来 | 日志第一段报错 | 端口/token/Node 版本 |
| QQ 有消息 AI 不回 | 白名单、DSH ready、模型配置 | 逐项确认；看是否会话被过滤 |
| 双回复 | 是否两个桥接进程 | 杀多余进程，启动脚本加幂等 |
| 网关没 hook | QQ 是否在线、账号是否一致 | 重登网关；确认 UIN |
| 发消息失败 | OneBot 返回码 | 群临时会话带 group_id；非好友私聊可能被 QQ 限制 |
| 补丁冲突 | 上游版本 | `git apply --3way` 或手工移植 new-files |
| 重置后失忆 | 补记文件与注入逻辑 | 检查补记开关、文件写入 |
| 工具不出现 | DSH 是否重启 | 重启 DSH 再试 |


