# B站 登录隔几个月掉一次线：加「登录守护」自动续期

日期：2026-11-05

## 1. 现象

- 用户手动粘贴 / 扫码登录 B站 后，过一段时间（约半年）nav 开始回「账号未登录」，
  B站 相关自动化（评论/动态/分享/鱼群保护/生物钟）全部跳过，只能重新扫码或重新粘 cookie。
- 用户要求：「想保持 B站 长期稳定登录」。

## 2. 根因

- B站 web cookie（`SESSDATA` / `bili_jct`）签发时自带约 **180 天**有效期，
  **不主动续期就不会续命**（见 bilibili-API-collect `docs/login/cookie_refresh.md`）。
- 官方网页端靠每天检查一次 `x/passport-login/web/cookie/info` 的 `refresh` 标记，
  需要时走「RSA 签名拿 refresh_csrf → 刷新 cookie → 确认更新」链路续期，
  凭据是登录时下发的 `refresh_token`（网页端存在 `localStorage.ac_time_value`）。
- surfcore 之前只保存 `sessdata / bili_jct / buvid3`：
  - 从来没有拿到过 `refresh_token`（扫码登录只捡了 4 个 cookie）；
  - 手动粘贴入口还会**整个覆盖** `credentials.json`，即便以后拿到了令牌也会被抹掉；
  - 没有任何定期检查，只能等掉线后被动发现。

## 3. 改动

### 3.1 新模块

- `plugins/surfcore/lib/bili-cookie-refresh.mjs`（纯实现，可单测）：
  - `getCorrespondPath(ts)`：RSA-OAEP(SHA-256) 加密 `refresh_<毫秒时间戳>`，输出 256 位小写 hex；
  - `fetchCookieInfo(cred)`：GET `cookie/info`，区分 `-101 未登录` / `refresh: true/false`；
  - `fetchRefreshCsrf(cred, timestamp)`：GET `https://www.bilibili.com/correspond/1/<correspondPath>`，
    从 `<div id="1-name">` 抠 `refresh_csrf`（404 页明确报错，不当成空口令）；
  - `refreshCookie(cred)`：POST `cookie/refresh`（带 `csrf` / `refresh_csrf` / `source=main_web` / `refresh_token`），
    解析响应里的新 `SESSDATA` / `bili_jct` / `refresh_token`；
  - `confirmRefresh(cred, oldToken)`：POST `confirm/refresh` 让旧令牌失效。
- `plugins/surfcore/lib/bili-login-keeper.mjs`（状态机）：
  - 每 `loginKeeper.intervalHours`（默认 6，1~168）检查一次；
  - 有 `refreshToken` 且 B站 说该续期 → 续期，**先落盘新凭据，再确认旧令牌失效**（顺序反了会丢登录）；
  - 没有令牌 → 状态 `no-refresh-token`，节流通知主人（12/24 小时不重复轰炸）；
  - `-101` → `expired` 并通知；网络错误 → `error`，不误报成过期；
  - 状态写到 `~/.dsh/surfcore/bili/login-keeper.json`，**只存时间和状态，不存任何令牌**；
  - 通知优先走桥接 `/api/notify/owner`，桥接不可用时回落到 `tools/commands/notify.mjs`。

### 3.2 凭据来源改造

- 扫码登录（`lib/bili-qr-login.mjs`）：
  - CDP 截 `passport-login/web/qrcode/poll`（或 `web/login`）响应体，拿 `data.refresh_token`；
  - 截不到再读页面 `localStorage.ac_time_value`（当前页 + 跳 `www.bilibili.com` 各读一次）；
  - 写凭据时新增 `refreshToken` / `refreshTokenAt` / `loginMethod: 'qr'`。
- 手动粘贴（`lib/index.js` 的 `action=cookie`）：
  - 支持可选的 `refreshToken`（ac_time_value）；
  - **同一个号**再次粘贴时保留已有 `refreshToken`（以前直接覆盖，会把令牌抹掉）；
  - 返回值提示「有没有续期令牌」，UI 同步显示。

### 3.3 设置页 / 配置

- B站 页「高级设置」新增「登录守护（自动续期）」卡：状态、令牌有无、上次检查、上次续期、下次检查、
  「立即检查」「立即续期」、`enabled` / `autoRefresh` / `intervalHours` 开关（随本页底部保存）。
- 「手动粘贴凭据」卡新增 `ac_time_value / 续期令牌（可空）` 输入，并写明怎么从浏览器控制台取。
- 配置新增 `loginKeeper` 段（`lib/store.js` 默认值 + 归一）：
  `{ enabled: true, intervalHours: 6, autoRefresh: true, notifyOnRefresh: false }`。
- 宿主接口：`GET /bili/login-keeper`（只读状态）、`POST /bili/login-keeper {action:'login-keeper', target, force}`。
- 插件启动 45 秒后跑第一次，之后每 30 分钟看一眼「到点没」（到点才真的问 B站）。

## 4. 生效 / 边界

- **扫码一次**才会拿到 `refresh_token`；之后自动续期不需要再扫码。
- 手动粘贴的 cookie **没有**续期令牌 → 只能靠「补 ac_time_value」或重新扫码；
  到需要续期时会通知，不会偷偷失败。
- 同一个号如果还在浏览器里日常登录，浏览器刷新令牌可能把 bot 的令牌顶掉；
  专用号最稳（现状就是专用小号）。
- 续期不是「无限续命」：账号被风控强制下线、令牌被别处换掉仍需重新扫码。
- 网络请求只发 `passport.bilibili.com` / `www.bilibili.com`；日志与接口都不回显 cookie / 令牌。

## 5. 验证

```text
node scripts/test-bili-login-keeper.mjs      # correspondPath / 刷新链路 / 状态机（mock，不联网）
node scripts/test-bili-qr-login.mjs          # 扫码归属校验不回退
node plugins/surfcore/scripts/test-store.mjs
node plugins/surfcore/scripts/test-client-contract.mjs
node scripts/test-audit.mjs                  # 全量审计（已登记新测试）
```

真机验证（2026-11-05，当前凭据）：

- `cookie/info` 返回 `code:0, refresh:false`（登录有效，暂不需要续期）；
- 用返回的 `timestamp` 生成 correspondPath → `GET /correspond/1/<path>` 真拿到 32 位 `refresh_csrf`
  （说明 RSA-OAEP 实现与官方一致，只差 `refresh_token` 就能走完整刷新）；
- `runLoginKeeper({target:'fish'})` 落 `lastStatus: ok`，状态文件正常写入，未泄露 cookie。

## 6. 影响面

- 新增文件：`lib/bili-cookie-refresh.mjs`、`lib/bili-login-keeper.mjs`、`scripts/test-bili-login-keeper.mjs`；
- 修改：`lib/bili-qr-login.mjs`、`lib/index.js`、`lib/client.js`、`lib/store.js`、`scripts/test-audit.mjs`；
- 不改任何现有工具命令的 cookie 读法（仍是三件套），续期只是让三件套一直有效。

