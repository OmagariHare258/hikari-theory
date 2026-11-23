# B站定时分享提示缺 token / 群号（2026-11-05）

## 现象

B站定时分享到点后，二代仿真（reserved2）会话拿到了「定时分享」提示，但提示里没有【会话令牌】也没有会话 key；小光调用 `mcp__snowluma__qq_send_message` 时被桥接 v2 接口全部拒绝：

> 必须携带有效的会话令牌

分享发不出去，只能挂起问主人「继续发还是跳过」。

## 根因

- `src/bili-share-scheduler.js` 的 `buildSharePrompt()` 在 reserved2 模式下只写「请调用 qq_send_message」，**没有带 key/token**；
- 正常唤醒的提示词里 token 由 `buildWakePromptV2` 注入，但定时分享走的是 `deliverPrompt(key, prompt)` 裸提示，不经过唤醒提示；
- 另外 `createBiliShareScheduler` 的循环把 targets 一律拼成 `group:${target}`，而桥接传进来的 `shareTargets` 可能已经是 `private:10000001`（`ownerPrivate=true`）→ 主人私聊目标实际变成了非法的 `group:private:...`。

## 修复

1. `buildSharePrompt(..., { sessionKey, token })`：reserved2 模式下追加一行：
   `6. 工具参数：key=<key>；会话令牌（token）=<token>。token 只用于工具参数，不要写进消息、不要外传。`
2. `createBiliShareScheduler({ getSessionToken })`：到点投递前取当前会话 token（桥接传 `getSocialV2State(key).agentToken`）。
3. 目标 key 归一：`String(target).includes(':') ? target : \`group:${target}\``，修掉 `group:private:...`。
4. 新增 `scripts/test-bili-share-prompt.mjs`（已登记 audit）：reserved2 必带 key/token、私聊目标带 key、chat 模式不注入、静态检查桥接确实传了 getSessionToken。

## 验证

```text
node scripts/test-bili-share-prompt.mjs
node scripts/test-bili-share-dedup.mjs
```

桥接重启后日志：

```text
[B站分享] 已排定：… → 2 个目标（含私聊）
```

下次 19:30 的分享会带上 key/token，小光可以直接发；旧的那条按「跳过/丢掉」处理。

