# QQ 里的管理工具（仅主人私聊）

目标：主人在和小光的私聊里，直接让她改人格卡，不用切设置页。

## 工具

| 工具 | 作用 |
|---|---|
| `admin_persona_search(q)` | 在人格卡里搜原句，返回行号+原文 |
| `admin_persona_patch(old, new, confirm?)` | 替换唯一匹配的一句；默认只预览，`confirm=true` 才写入 |

## 流程

1. 主人说「把人格卡里 XX 改成 YY」；
2. 小光先 `admin_persona_search` 找到原句；
3. `admin_persona_patch` 干跑，把前后文预览给主人；
4. 主人确认后，`confirm=true` 写入；
5. 写入前自动备份到 `state/persona-backups/persona-<时间>.md`；
6. 小光回一句「改了哪句」。

## 权限与边界

- **只有主人私聊**能用；群聊、好友私聊、别人的会话一律 403；
- 只改 `persona.md`，不改 config、不跑 shell、不装插件；
- `old` 必须唯一匹配；0 次或多次都拒绝，避免误改；
- 写入走原子写，失败不会留半截。

## 为什么不直接把 DSH 全权限接进 QQ

QQ 是外部输入面：群友、转发、图片文字都可能带指令。把 `pwsh/read/write` 这类工具暴露给 QQ 会话，等于把本机执行权交给「任何能让小光读到一句话的人」。所以当前只开主人私聊的窄口子。

如果确实需要「让小光在 QQ 里跑 DSH 任务」（装插件、跑脚本、改配置），应另开 **owner-only 的 DSH 任务通道**：主人私聊发起、独立会话、完整工具面、结果回传，而不是把工具塞进 QQ preset。

## 路由

- `GET /api/admin/persona?key=&q=`
- `POST /api/admin/persona/patch`（body: key, old, new, confirm）
