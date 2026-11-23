# B站 私信：双向关注的好友像 QQ 一样聊

> 2026-11-05 用户要求：B站 上互相关注的好友能像 QQ 私聊一样正常交流。
> 改的是 `dm.mjs`（私信工具）与 `scheduler.js`（私信叫醒提示词）。

## 现在的行为

1. **监听**：`listen.dm=true`、`listen.dmScope=all` 时，`dm-await` 会轮询所有私信会话（不只是主人）；
2. **叫醒**：有新私信就叫醒她，提示词里带对方 mid / 昵称 / 原文；
3. **回复**：
   - 主人：`dm --msg "…" --go`，直接回；
   - **双向关注好友**：`dm --to <mid> --msg "…" --go`，像 QQ 私聊一样短句、多轮；
   - 非好友：`dm --to <mid>` 也能回，但走陌生人通道，限制更紧；
4. **只能回、不能主动发**：工具会检查会话最后一条是不是对方说的；她自己最后说的就等对方再说。

## 额度（可在 `bili.config.json` 改）

```json
"dm": {
  "friends": {
    "enabled": true,
    "mutualOnly": true,
    "perPersonDaily": 10,
    "totalDaily": 30,
    "maxLen": 300
  }
}
```

| 对象 | 每人每天 | 全天总 | 单条长度 |
|---|---|---|---|
| 双向关注好友 | 10 条 | 30 条 | 300 字 |
| 非好友（陌生人回复） | 3 条 | 30 条 | 200 字 |

- 双向关注判定：`relation attribute === 6`；
- 额度记账在 `dm-quota.json`（`replied` / `replyTotal`）；
- 超过额度会拒绝并提示"留到明天"。

## 怎么验证

1. 用互关的账号给她发一条 B站 私信；
2. 看 B站 会话是否出现新消息，日志里是否 `DM_HIT mid=…`；
3. 她回复后，`dm-quota.json` 的 `replied` 会出现对方的 mid。

## 限制

- 她**不会主动私聊好友**（B站 私信风控严，只做回复）；
- 对方最后一条超过 48 小时就不回（避免"突然诈尸"）；
- 私信内容仍受出站身份闸限制（不能泄露主人/别人的 QQ 号、mid 等）；
- 如果 B站 账号被风控（评论/私信 `state=17` 等），先养号再恢复频率。
## 找联系人（不用向主人要号）

```bash
node bili.mjs contacts            # 互关好友
node bili.mjs contacts --q 名字    # 按名字筛
node bili.mjs contacts --all      # 互关 + 关注 + 粉丝
node bili.mjs contacts --json
```

输出形如：`名字（mid 123）`。先查联系人，再决定 DM 发给谁；不要在不知道 mid 时向主人要号。
