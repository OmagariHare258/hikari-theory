/**
 * B站 Web 端登录凭据续期（「登录守护」的底层实现）。
 *
 * 为什么需要它：
 *   B站 的 web cookie（SESSDATA）自带约 **180 天**的有效期；只要不主动调用官方的
 *   cookie 刷新接口，它就不会续命。到期后 nav 直接回「未登录」，所有写操作全挂，
 *   只能人工重新扫码 —— 这就是「登录偶尔掉线」的根因。
 *
 * 官方刷新链路（社区逆向，见 bilibili-API-collect docs/login/cookie_refresh.md）：
 *   ① GET  /x/passport-login/web/cookie/info         → { refresh, timestamp }
 *   ② RSA-OAEP(SHA-256) 加密 `refresh_<timestamp>`   → correspondPath（小写 hex）
 *   ③ GET  https://www.bilibili.com/correspond/1/<correspondPath>
 *       页面的 <div id="1-name"> 里就是 refresh_csrf
 *   ④ POST /x/passport-login/web/cookie/refresh      → 新的 SESSDATA/bili_jct + 新 refresh_token
 *   ⑤ POST /x/passport-login/web/confirm/refresh     → 让旧 refresh_token 失效（确认更新）
 *
 * 硬边界：
 *   · 只读写本机凭据文件，不打印 SESSDATA / bili_jct / refresh_token 的值；
 *   · 刷新令牌（refresh_token，网页端叫 ac_time_value）只在**登录成功那一刻**下发，
 *     手动粘贴的 cookie 没有它 → 只能提示用户补一次，绝不伪造/猜测；
 *   · 所有网络请求只发 B站 官方域名（passport.bilibili.com / www.bilibili.com）。
 */
import crypto from 'node:crypto';

export const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** correspondPath 用的 B站 固定 RSA 公钥（JWK n/e 的 PEM 形式）。 */
export const BILI_CORRESPOND_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg
Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71
nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40
JNrRuoEUXpabUzGB8QIDAQAB
-----END PUBLIC KEY-----`;

const BASIC_HEADERS = {
  'user-agent': BILI_UA,
  referer: 'https://www.bilibili.com/',
  origin: 'https://www.bilibili.com/',
};

/**
 * 生成 correspondPath：RSA-OAEP(SHA-256) 加密 `refresh_<毫秒时间戳>`，输出小写 hex。
 * 纯函数，单测覆盖（长度固定 256 hex = 1024 位密钥）。
 */
export function getCorrespondPath(timestamp) {
  const ts = Math.round(Number(timestamp));
  if (!Number.isFinite(ts) || ts <= 0) throw new Error('timestamp 必须是毫秒时间戳');
  const key = crypto.createPublicKey(BILI_CORRESPOND_PUBLIC_KEY);
  const encrypted = crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(`refresh_${ts}`, 'utf8'),
  );
  return encrypted.toString('hex');
}

/** 把凭据对象收敛成刷新链路要的形状（只取需要的四项，其余字段原样由调用方保留）。 */
export function normalizeCredential(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    sessdata: String(raw.sessdata ?? raw.SESSDATA ?? '').trim(),
    bili_jct: String(raw.bili_jct ?? raw.biliJct ?? '').trim(),
    buvid3: String(raw.buvid3 ?? '').trim(),
    refreshToken: String(raw.refreshToken ?? raw.refresh_token ?? raw.acTimeValue ?? '').trim(),
  };
}

export function cookieHeaderOf(cred) {
  const c = normalizeCredential(cred);
  const parts = [];
  if (c.sessdata) parts.push(`SESSDATA=${c.sessdata}`);
  if (c.bili_jct) parts.push(`bili_jct=${c.bili_jct}`);
  if (c.buvid3) parts.push(`buvid3=${c.buvid3}`);
  return parts.join('; ');
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function getJson(url, cred, { fetchImpl = fetch, timeoutMs = 12_000 } = {}) {
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { ...BASIC_HEADERS, cookie: cookieHeaderOf(cred) }, signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { http: res.status, json, text };
  } finally {
    done();
  }
}

async function postForm(url, fields, cred, { fetchImpl = fetch, timeoutMs = 12_000 } = {}) {
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        ...BASIC_HEADERS,
        cookie: cookieHeaderOf(cred),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
      signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return { http: res.status, json, setCookies: parseSetCookieList(setCookie) };
  } finally {
    done();
  }
}

/**
 * 检查当前 cookie 是否「需要刷新」。
 * B站 返回 -101 表示登录失效（过期/被踢）；code 0 时 data.refresh 才是是否该续期。
 */
export async function fetchCookieInfo(cred, options = {}) {
  const c = normalizeCredential(cred);
  if (!c.sessdata || !c.bili_jct) {
    return { ok: false, code: 'bili.no-credentials', error: '凭据缺少 SESSDATA/bili_jct' };
  }
  const url = `https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=${encodeURIComponent(c.bili_jct)}`;
  let result;
  try {
    result = await getJson(url, c, options);
  } catch (error) {
    return { ok: false, code: 'bili.network', error: `连不上 B站（${String(error?.message ?? error).slice(0, 120)}）` };
  }
  const code = Number(result.json?.code);
  if (!result.json || !Number.isFinite(code)) {
    return { ok: false, code: 'bili.bad-response', error: `B站 返回了非 JSON（HTTP ${result.http}）`, http: result.http };
  }
  if (code === -101) {
    return { ok: false, code: 'bili.cookie-expired', error: 'B站 返回「账号未登录」（cookie 过期或被踢下线）', apiCode: code };
  }
  if (code !== 0) {
    return { ok: false, code: 'bili.api-error', error: `B站 cookie/info 返回 ${code}：${result.json?.message ?? ''}`, apiCode: code };
  }
  return {
    ok: true,
    refresh: result.json?.data?.refresh === true,
    timestamp: Number(result.json?.data?.timestamp ?? 0) || 0,
  };
}

/** 从 correspond 页面 HTML 里抠 refresh_csrf（<div id="1-name">…</div>）。 */
export function parseRefreshCsrf(html) {
  const match = /<div[^>]*\bid=["']1-name["'][^>]*>([^<]{8,512})<\/div>/i.exec(String(html ?? ''));
  return match ? match[1].trim() : '';
}

/** 把 Set-Cookie 头数组解析成 { 名字: 值 }（只取第一个分号前的键值对）。 */
export function parseSetCookieList(list) {
  const out = {};
  for (const line of Array.isArray(list) ? list : []) {
    const pair = String(line ?? '').split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/** 第 ③ 步：拿 refresh_csrf。correspondPath 用 cookie/info 返回的 timestamp 生成，别用本地时间。 */
export async function fetchRefreshCsrf(cred, timestamp, options = {}) {
  const c = normalizeCredential(cred);
  const ts = Number(timestamp) || Date.now();
  let correspondPath;
  try {
    correspondPath = getCorrespondPath(ts);
  } catch (error) {
    return { ok: false, code: 'bili.correspond-path', error: String(error?.message ?? error) };
  }
  const url = `https://www.bilibili.com/correspond/1/${correspondPath}`;
  const { signal, done } = withTimeout(options.timeoutMs ?? 12_000);
  try {
    const res = await (options.fetchImpl ?? fetch)(url, { headers: { ...BASIC_HEADERS, cookie: cookieHeaderOf(c) }, signal });
    const html = await res.text();
    const refreshCsrf = parseRefreshCsrf(html);
    if (!refreshCsrf) {
      return {
        ok: false, code: 'bili.correspond-failed', correspondPath, http: res.status,
        error: `correspond 页面没返回 refresh_csrf（HTTP ${res.status}）——对应参数可能已过期，或 cookie 已失效`,
      };
    }
    return { ok: true, correspondPath, refreshCsrf, http: res.status };
  } catch (error) {
    return { ok: false, code: 'bili.network', error: `打开 correspond 页面失败（${String(error?.message ?? error).slice(0, 120)}）` };
  } finally {
    done();
  }
}

/**
 * 完整的 ④ 步：用 refresh_token + refresh_csrf 换新 cookie。
 * 返回 { ok, cred:{sessdata,bili_jct,buvid3,refreshToken}, oldRefreshToken, apiCode }。
 * **不在这里做 confirm**：调用方必须先把新凭据落盘，再调 confirmRefresh（否则写盘失败会丢登录）。
 */
export async function refreshCookie(cred, options = {}) {
  const current = normalizeCredential(cred);
  if (!current.sessdata || !current.bili_jct) {
    return { ok: false, code: 'bili.no-credentials', error: '凭据缺少 SESSDATA/bili_jct' };
  }
  if (!current.refreshToken) {
    return {
      ok: false, code: 'bili.no-refresh-token',
      error: '这份凭据没有续期令牌（refresh_token / ac_time_value），无法自动续期',
      hint: '扫码登录一次；或在「手动粘贴凭据」里补上 ac_time_value',
    };
  }
  const info = await fetchCookieInfo(current, options);
  if (!info.ok) return info;
  if (!info.refresh) {
    // B站 说不需要刷新 → 不主动换 cookie（避免把好好的登录态换出问题）。
    return { ok: true, refreshed: false, cred: current, reason: 'bili.no-refresh-needed' };
  }
  const csrf = await fetchRefreshCsrf(current, info.timestamp, options);
  if (!csrf.ok) return csrf;
  let result;
  try {
    result = await postForm(
      'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
      {
        csrf: current.bili_jct,
        refresh_csrf: csrf.refreshCsrf,
        source: 'main_web',
        refresh_token: current.refreshToken,
      },
      current,
      options,
    );
  } catch (error) {
    return { ok: false, code: 'bili.network', error: `刷新 cookie 请求失败（${String(error?.message ?? error).slice(0, 120)}）` };
  }
  const apiCode = Number(result.json?.code);
  if (apiCode !== 0) {
    const detail = apiCode === 86095
      ? 'refresh_csrf / refresh_token 与当前 cookie 不匹配（可能这个号在别处登录过，令牌被换掉了）'
      : (result.json?.message ?? '');
    return {
      ok: false, code: 'bili.refresh-failed', apiCode,
      error: `刷新 cookie 失败（code ${Number.isFinite(apiCode) ? apiCode : '?'}）${detail ? `：${detail}` : ''}`,
      hint: '重新扫码登录一次最稳（会拿到新的 refresh_token）',
    };
  }
  const next = {
    sessdata: result.setCookies.SESSDATA || current.sessdata,
    bili_jct: result.setCookies.bili_jct || current.bili_jct,
    buvid3: result.setCookies.buvid3 || current.buvid3,
    refreshToken: String(result.json?.data?.refresh_token ?? '').trim() || current.refreshToken,
  };
  return { ok: true, refreshed: true, cred: next, oldRefreshToken: current.refreshToken, apiCode };
}

/**
 * 第 ⑤ 步：确认更新（让旧 refresh_token 失效）。
 * 必须在**新凭据已落盘**之后调用；失败不影响新凭据本身，只是旧令牌还能用。
 */
export async function confirmRefresh(cred, oldRefreshToken, options = {}) {
  const c = normalizeCredential(cred);
  const oldToken = String(oldRefreshToken ?? '').trim();
  if (!c.sessdata || !c.bili_jct) return { ok: false, code: 'bili.no-credentials', error: '缺少新凭据' };
  if (!oldToken) return { ok: false, code: 'bili.no-old-token', error: '缺少旧 refresh_token' };
  try {
    const { json } = await postForm(
      'https://passport.bilibili.com/x/passport-login/web/confirm/refresh',
      { csrf: c.bili_jct, refresh_token: oldToken },
      c,
      options,
    );
    const code = Number(json?.code);
    if (code === 0) return { ok: true };
    return { ok: false, code: 'bili.confirm-failed', apiCode: code, error: `确认更新失败（code ${Number.isFinite(code) ? code : '?'}）` };
  } catch (error) {
    return { ok: false, code: 'bili.network', error: `确认更新请求失败（${String(error?.message ?? error).slice(0, 120)}）` };
  }
}

