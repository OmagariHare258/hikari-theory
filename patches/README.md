# 补丁说明

本目录是本地 SurfCore 工作区的导出（已脱敏，不含个人配置/凭据/状态目录）。

## 两个补丁

| 文件 | 用途 |
|---|---|
| `surfcore-local-updates.patch` | **全量本地改动**（tracked 文件 diff）：桥接、插件、B站、语音、文档、脚本等。用来把仓库同步到"当前本地状态"。 |
| `surfcore-tracked-changes.patch` | **原创核心子集**（桥接自愈/事务台/发图/B站抗风控等），适合只想练核心逻辑的人。 |

## 新文件

`new-files/` 保留相对路径，包含全部新增源码/文档/脚本（cross-task、voice-affection、affection-impressions、B站登录保持、contacts、测试与案例等）。

## 使用（顺序很重要）

1. 准备上游 surfcore 仓库（基准见 `VERSIONS.md`）。
2. **先打全量补丁**：`git apply --whitespace=nowarn patches/surfcore-local-updates.patch`。
   - 若失败，再试 `git apply --3way`；仍失败就用 `surfcore-tracked-changes.patch` 核心子集。
3. **再复制** `new-files/` 到对应路径（已存在的文件跳过）。顺序反了会报 "does not exist in index"。
4. `npm install`，按 `examples/` 生成 `config.json` 与 `state/privacy.json`。
5. 按 `docs/engineering-changelog.md` / `docs/guides/INSTALL-FULL-STACK.md` 检查配置项和验收。

`scripts/bootstrap.ps1` 已经按这个顺序自动执行。

## 注意

- 不含 `config.json`、`state/`、令牌、QQ号/群号真实值（全部替换为占位符）。
- 上游版本差异大时优先手工移植 `new-files/` 与核心子集。
- MIT 许可，风险自负；上游协议优先。
