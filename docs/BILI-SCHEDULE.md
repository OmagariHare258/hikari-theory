# B站 作息：工作日 / 周末两套（拟人化）

> 2026-11-05 用户要求：工作日集中在中午，周末放松一点（早上八点或十一点都可能）。
> 改的是 `whale-night.mjs`（生物钟）与 `bili.config.json` 的 `night.profiles`。

## 设计

| 时段 | 窗口 | 全天最多醒 | 说明 |
|---|---|---|---|
| 工作日（周一–周五） | 12:00–14:00 | 1 次 | 午休刷一会儿，集中在中午 |
| 周末（周六、周日） | 08:00–10:00 / 11:00–13:00 / 20:00–23:00 | 2 次 | 早上懒觉后或中午、晚上各一次；三选二 |

- 每个窗口内随机挑时刻，不整点；
- 每次醒来仍有 `skipChance` 概率"今天不想看"（工作日 15%、周末 10%）；
- 窗口只是"机会"，全天次数才是硬上限（`maxWakesPerDay`）。

## 配置

`~/.dsh/surfcore/bili.config.json`：

```json
"night": {
  "windows": [ { "start": "20:00", "end": "24:00", "wakes": 1 } ],
  "profiles": {
    "weekday": {
      "windows": [ { "start": "12:00", "end": "14:00", "wakes": 1 } ],
      "maxWakesPerDay": 1,
      "skipChance": 0.15,
      "maxVideos": 5,
      "minGapMin": 20
    },
    "weekend": {
      "windows": [
        { "start": "08:00", "end": "10:00", "wakes": 1 },
        { "start": "11:00", "end": "13:00", "wakes": 1 },
        { "start": "20:00", "end": "23:00", "wakes": 1 }
      ],
      "maxWakesPerDay": 2,
      "skipChance": 0.1,
      "maxVideos": 6,
      "minGapMin": 20
    }
  }
}
```

- 没有 `profiles` 时退回原来的 `night.windows`，不影响旧配置；
- `night.profiles` 里的字段与顶层 `night` 同名，会覆盖顶层；
- 想临时验证哪套作息：`node bili.mjs night plan --day-type weekend --dry-run`（不写状态）。

## 踩过的坑

`buildNightSchedule` 内部会对窗口再归一化一次；如果直接把已经转成分钟数的窗口对象传进去，`normalizeWindow` 会判定非法、回退成默认 `20:00–24:00`。所以 `whale-night.mjs` 传的是**原始字符串窗口**（`RAW_WINDOWS`），而不是内部的 `WINDOWS`。

## 另一个已知问题：评论 state=17（仅自己可见）

发出去的分享评论可能返回成功（有 rpid），但 B站 侧 `state=17`，只有自己可见，别人（包括主人）看不到、也收不到 @ 通知。常见于新设备登录、账号等级低、短时间发评论较多。处理建议：

1. 等一段时间看是否转公开；
2. 降低发评论频率（新号先养几天）；
3. 完成手机号/实名等账号验证；
4. 持续 17 不恢复时，换号或人工申诉。
## 分享通道：改用 B站 私信（2026-11-05）

评论区分享在新号/新设备上容易被判 `state=17`（仅自己可见），主人收不到 @。临时把分享通道切到私信：

```json
"share": { "enabled": true, "via": "dm" }
```

- 私信只发给主人（`owner.mid`），互关校验通过才会发；
- 和评论区分享共用同一本额度（`quota.shareDaily`，默认 3/天）；
- 私信消息同样走"分享型"记账，不占普通评论额度；
- 之后账号养稳、评论能正常公开时，可以把 `via` 改回 `comment`。
