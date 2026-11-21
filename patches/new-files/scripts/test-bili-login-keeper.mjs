// B站 登录守护：correspondPath 签名、refresh_csrf 解析、刷新链路、状态机。
// 全部用 mock fetch / 临时 DSH_HOME，不联网、不动真实凭据。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-login-keeper-'));
process.env.DSH_HOME = tmpHome;
const biliDir = path.join(tmpHome, 'surfcore', 'bili');
fs.mkdirSync(biliDir, { recursive: true });
const credFile = path.join(biliDir, 'credentials.json');

const refresh = await import('../plugins/surfcore/lib/bili-cookie-refresh.mjs');
const keeper = await import('../plugins/surfcore/lib/bili-login-keeper.mjs');
const { normalizeBiliConfig } = await import('../plugins/surfcore/lib/store.js');

// ── ① correspondPath：固定 256 位小写 hex（1024 位密钥 → 128 字节密文）─────
const cp1 = refresh.getCorrespondPath(1793858224140);
const cp2 = refresh.getCorrespondPath(1793858224140);
assert.match(cp1, /^[0-9a-f]{256}$/, 'correspondPath 必须是 256 位小写 hex');
assert.notEqual(cp1, cp2, 'RSA-OAEP 带随机填充，同输入两次结果也应不同（防写死）');
assert.notEqual(refresh.getCorrespondPath(1793858224141), cp1);
assert.throws(() => refresh.getCorrespondPath(0), /毫秒时间戳/);

// ── ② HTML / Set-Cookie 解析 ──────────────────────────────────────────────
const html = `<!DOCTYPE html><html><body>
  <div id="1-name">b0cc8411ded2f9db2cff2edb3123acac</div>
  <div id="token-iframe-app"></div></body></html>`;
assert.equal(refresh.parseRefreshCsrf(html), 'b0cc8411ded2f9db2cff2edb3123acac');
assert.equal(refresh.parseRefreshCsrf('<html><body>404 Page</body></html>'), '', '404 页面不能糊出一个 csrf');
assert.equal(refresh.parseRefreshCsrf(`<div class="x" id='1-name'>  abcdefgh12345678  </div>`), 'abcdefgh12345678');

const cookies = refresh.parseSetCookieList([
  'SESSDATA=NEWSESS; Path=/; Domain=bilibili.com; Expires=Wed, 15 Nov 2023 07:34:10 GMT; HttpOnly; Secure',
  'bili_jct=NEWJCT; Path=/; Domain=bilibili.com',
  'DedeUserID=42; Path=/',
  'bogus-line-without-equals',
]);
assert.equal(cookies.SESSDATA, 'NEWSESS');
assert.equal(cookies.bili_jct, 'NEWJCT');
assert.equal(cookies.DedeUserID, '42');
assert.equal(refresh.cookieHeaderOf({ sessdata: 'S', bili_jct: 'J', buvid3: 'B' }), 'SESSDATA=S; bili_jct=J; buvid3=B');
assert.equal(refresh.cookieHeaderOf({ sessdata: 'S', bili_jct: 'J' }), 'SESSDATA=S; bili_jct=J', 'buvid3 可空');
assert.equal(refresh.normalizeCredential({ SESSDATA: ' s ', biliJct: 'j', acTimeValue: ' tok ' }).refreshToken, 'tok');

// ── ③ 刷新链路（mock fetch）──────────────────────────────────────────────
function jsonResponse(body, extra = {}) {
  return { status: 200, text: async () => JSON.stringify(body), headers: { getSetCookie: () => extra.setCookies ?? [] } };
}
function htmlResponse(body, status = 200) {
  return { status, text: async () => body, headers: { getSetCookie: () => [] } };
}
const REFRESH_TOKEN = 'rtoken-old-123';
const infoNeedsRefresh = { code: 0, message: '0', data: { refresh: true, timestamp: 1793858224140 } };
const infoNoRefresh = { code: 0, message: '0', data: { refresh: false, timestamp: 1793858224140 } };
const correspondHtml = '<html><div id="1-name">' + 'a'.repeat(32) + '</div></html>';
const refreshOk = {
  code: 0, message: '0',
  data: { status: 0, message: '', refresh_token: 'rtoken-new-456' },
};

function makeFetch(routes) {
  const entries = Object.entries(routes);
  return async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    for (const [pattern, hit] of entries) {
      const space = pattern.indexOf(' ');
      const patternMethod = pattern.slice(0, space).toUpperCase();
      const target = pattern.slice(space + 1);
      const matched = patternMethod === method
        && (target.endsWith('*') ? String(url).startsWith(target.slice(0, -1)) : String(url) === target);
      if (!matched) continue;
      return typeof hit === 'function' ? hit(init) : hit;
    }
    throw new Error(`未 mock 的请求：${method} ${url}`);
  };
}

const baseCred = { sessdata: 'SESS', bili_jct: 'JCT', buvid3: 'BUVID3', refreshToken: REFRESH_TOKEN };

// 没有 refresh_token → 明确拒绝，不去猜
let result = await refresh.refreshCookie({ sessdata: 'S', bili_jct: 'J' }, { fetchImpl: async () => { throw new Error('不该发请求'); } });
assert.equal(result.ok, false);
assert.equal(result.code, 'bili.no-refresh-token');

// cookie 失效（-101）
result = await refresh.refreshCookie(baseCred, {
  fetchImpl: makeFetch({
    'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=JCT': jsonResponse({ code: -101, message: '账号未登录' }),
  }),
});
assert.equal(result.ok, false);
assert.equal(result.code, 'bili.cookie-expired');

// 不需要刷新 → 什么都不换
result = await refresh.refreshCookie(baseCred, {
  fetchImpl: makeFetch({
    'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=JCT': jsonResponse(infoNoRefresh),
  }),
});
assert.equal(result.ok, true);
assert.equal(result.refreshed, false);

// 完整成功：info → correspond → refresh（拿新 cookie 和新令牌）
const successFetch = makeFetch({
  'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=JCT': jsonResponse(infoNeedsRefresh),
  'GET https://www.bilibili.com/correspond/1/*': htmlResponse(correspondHtml),
  'POST https://passport.bilibili.com/x/passport-login/web/cookie/refresh': (init) => {
    assert.match(String(init.body), /source=main_web/, '必须带 source=main_web');
    assert.match(String(init.body), /refresh_token=rtoken-old-123/, '必须带旧 refresh_token');
    return jsonResponse(refreshOk, {
      setCookies: ['SESSDATA=NEWSESS; Path=/', 'bili_jct=NEWJCT; Path=/', 'DedeUserID=42; Path=/'],
    });
  },
  'POST https://passport.bilibili.com/x/passport-login/web/confirm/refresh': jsonResponse({ code: 0, message: '0', ttl: 1 }),
});
result = await refresh.refreshCookie(baseCred, { fetchImpl: successFetch });
assert.equal(result.ok, true, JSON.stringify(result));
assert.equal(result.refreshed, true);
assert.equal(result.cred.sessdata, 'NEWSESS');
assert.equal(result.cred.bili_jct, 'NEWJCT');
assert.equal(result.cred.refreshToken, 'rtoken-new-456');
assert.equal(result.cred.buvid3, 'BUVID3', '新响应没给 buvid3 时保留旧值');
assert.equal(result.oldRefreshToken, REFRESH_TOKEN);
const confirm = await refresh.confirmRefresh(result.cred, result.oldRefreshToken, { fetchImpl: successFetch });
assert.equal(confirm.ok, true);

// 86095：令牌与 cookie 不匹配
result = await refresh.refreshCookie(baseCred, {
  fetchImpl: makeFetch({
    'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=JCT': jsonResponse(infoNeedsRefresh),
    'GET https://www.bilibili.com/correspond/1/*': htmlResponse(correspondHtml),
    'POST https://passport.bilibili.com/x/passport-login/web/cookie/refresh': jsonResponse({ code: 86095, message: '请求错误' }),
  }),
});
assert.equal(result.ok, false);
assert.equal(result.code, 'bili.refresh-failed');
assert.match(result.error, /86095/);

// correspond 页 404（correspondPath 过期）→ 明确失败，不发刷新
result = await refresh.refreshCookie(baseCred, {
  fetchImpl: makeFetch({
    'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=JCT': jsonResponse(infoNeedsRefresh),
    'GET https://www.bilibili.com/correspond/1/*': htmlResponse('404 Page', 404),
  }),
});
assert.equal(result.ok, false);
assert.equal(result.code, 'bili.correspond-failed');

// ── ④ 守护状态机（临时目录里的真实凭据文件）───────────────────────────────
function writeCred(extra) {
  fs.writeFileSync(credFile, JSON.stringify({
    sessdata: 'SESS', bili_jct: 'JCT', buvid3: 'BUVID3',
    mid: '42', name: '测试鱼', savedAt: '2026-11-05T00:00:00.000Z', ...extra,
  }), 'utf8');
}
const fetchNoRefresh = makeFetch({
  'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=JCT': jsonResponse(infoNoRefresh),
});

assert.equal((await keeper.runLoginKeeper({ target: 'fish', notify: false, fetchImpl: fetchNoRefresh })).status, 'missing', '没凭据 → missing');

writeCred({});
let r = await keeper.runLoginKeeper({ target: 'fish', notify: false, fetchImpl: fetchNoRefresh });
assert.equal(r.status, 'ok');
const statusAfter = keeper.loginKeeperStatus();
assert.equal(statusAfter.targets.fish.hasRefreshToken, false);
assert.equal(statusAfter.targets.fish.lastStatus, 'ok');
assert.ok(statusAfter.targets.fish.lastCheckAt, '要记录检查时间');
assert.ok(statusAfter.targets.fish.nextCheckAt, '要给出下次检查时间');
assert.equal(keeper.loginKeeperDue({ target: 'fish' }), false, '刚查过不应立刻再查');
assert.ok(!JSON.stringify(statusAfter).includes('SESS'), '状态接口不能泄露 cookie 值');

// 需要续期但没令牌 → 明确状态（不自动乱来）
r = await keeper.runLoginKeeper({ target: 'fish', notify: false, fetchImpl: makeFetch({
  'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=JCT': jsonResponse(infoNeedsRefresh),
}) });
assert.equal(r.status, 'no-refresh-token');

// 有令牌 + B站 说该续 → 自动续期、落盘新凭据、确认旧令牌
writeCred({ refreshToken: REFRESH_TOKEN });
r = await keeper.runLoginKeeper({ target: 'fish', notify: false, fetchImpl: successFetch });
assert.equal(r.status, 'refreshed', JSON.stringify(r));
const saved = JSON.parse(fs.readFileSync(credFile, 'utf8'));
assert.equal(saved.sessdata, 'NEWSESS');
assert.equal(saved.bili_jct, 'NEWJCT');
assert.equal(saved.refreshToken, 'rtoken-new-456');
assert.equal(saved.mid, '42', '续期不能把 mid 弄丢');
assert.equal(saved.name, '测试鱼', '续期不能把昵称弄丢');
assert.ok(saved.refreshedAt, '要记录最近续期时间');
assert.ok(fs.statSync(credFile).isFile());
const statusRefreshed = keeper.loginKeeperStatus();
assert.equal(statusRefreshed.targets.fish.hasRefreshToken, true);
assert.ok(statusRefreshed.targets.fish.lastRefreshAt);
assert.ok(!JSON.stringify(statusRefreshed).includes('rtoken-new-456'), '状态接口不能泄露令牌值');

// 过期：接口 -101 → expired（不再尝试刷新）
r = await keeper.runLoginKeeper({ target: 'fish', notify: false, fetchImpl: makeFetch({
  'GET https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=NEWJCT': jsonResponse({ code: -101, message: '账号未登录' }),
}) });
assert.equal(r.status, 'expired');

// 网络错：别误报成过期
r = await keeper.runLoginKeeper({ target: 'fish', notify: false, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
assert.equal(r.status, 'error');

// ── ⑤ 配置归一 ───────────────────────────────────────────────────────────
const normalized = normalizeBiliConfig({ loginKeeper: { intervalHours: 0, enabled: false, autoRefresh: false } });
assert.equal(normalized.loginKeeper.enabled, false);
assert.equal(normalized.loginKeeper.autoRefresh, false);
assert.equal(normalized.loginKeeper.intervalHours, 1, '间隔下限 1 小时');
assert.equal(normalizeBiliConfig({}).loginKeeper.enabled, true, '默认开启');
assert.equal(normalizeBiliConfig({ loginKeeper: { intervalHours: 999 } }).loginKeeper.intervalHours, 168);

// 收尾：临时目录清掉
try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
console.log('OK test-bili-login-keeper');

