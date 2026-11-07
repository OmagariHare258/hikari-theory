# 补丁说明

本目录是从实际运行环境中导出的**原创工程改动**（已脱敏）。插件自带、无足够独创性的内容已剔除。

## 内容

| 文件 | 说明 |
|---|---|
| `surfcore-tracked-changes.patch` | 仅包含原创改动的 diff：桥接自愈、跨会话事务台接入、群临时会话回复、网络图片发送、MCP 工具、B站动态抗风控 |
| `new-files/` | 新增文件：`src/cross-task.js`、`scripts/test-cross-task.mjs`、`docs/cases/*cross*` |

## 如何使用

1. 准备一份上游 surfcore 仓库（版本差异大时用 `git apply --3way`）。
2. 把 `new-files/` 按相对路径复制到仓库对应位置。
3. `git apply --3way patches/surfcore-tracked-changes.patch`
4. 按 `docs/engineering-changelog.md` 检查配置项（`socialV2.crossTask`、`socialV2.wake`、`biliBridge.dynamics.pollIntervalMs` 等）。
5. 重启桥接与 DSH。

## 注意

- 补丁只覆盖原创部分；插件自带、无足够独创性的功能不包含在内。
- 所有真实账号/QQ/群号/令牌/路径均替换为占位符；应用前请填入本地配置。
- 补丁按 MIT 提供，使用风险自负；上游 surfcore 许可证请遵循其原始协议。

