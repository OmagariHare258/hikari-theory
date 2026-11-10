/**
 * B站「登录守护」：定期检查登录态、能续期就自动续期、续不了就通知主人。
 *
 * 目标（用户 2026-11-05）：B站 账号长期稳定登录，不要隔几个月掉一次线。
 *
 * 分工：
 *   · bili-cookie-refresh.mjs —— 官方刷新链路的纯实现（RSA 签名 / refresh_csrf / 刷新 / 确认）；
 *   · 本文件 —— 读凭据、跑检查、落盘新凭据、节流通知、给设置页吐状态（绝不回显 cookie）。
 *
 * 凭据文件里新增的字段（老文件没有也兼容）：
 *   refreshToken     登录时下发的持久化刷新口令（网页端 localStorage 的 ac_time_value）
 *   refreshTokenAt   什么时候拿到的（ISO 时间）
 *   refreshedAt      上一次自动续期的时间
 *   loginMethod      'qr' | 'manual'（怎么登录进来的，UI 用来给建议）
 *
 * 状态文件：~/.dsh/surfcore/bili/login-keeper.json（只记时间/状态，不记任何令牌）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { BILI_CRED, OWNER_BILI_CRED, BILI_DIR, BILI_TOOLS_DIR, findNodeExe, maskPath } from './paths.js';
import { readBiliConfig, readJson, writeJsonAtomic } from './store.js';
import { callBridge } from './bridge.js';
import { fetchCookieInfo, refreshCookie, confirmRefresh } from './bili-cookie-refresh.mjs';

const STATE_FILE = path.join(BILI_DIR, 'login-keeper.json');
const CRED_FILE = { fish: BILI_CRED, owner: OWNER_BILI_CRED };
const TARGET_LABEL = { fish: '小光', owner: '主人' };

export const DEFAULT_LOGIN_KEEPER = {
  enabled: true,
  intervalHours: 6,       // 多久检查一次（1~168 小时）
  autoRefresh: true,      // 需要续期且有 refresh_token 时自动续期
  notifyOnRefresh: false, // 续期成功也发一条通知（默认不吵）
};

const NOTIFY_GAP_MS = {
  expired: 12 * 3600_000,
  'no-refresh-token': 24 * 3600_000,
  'refresh-failed': 12 * 3600_000,
  refreshed: 0,
};

function positiveHours(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(168, Math.max(1, Math.round(n)));
}

export function readLoginKeeperConfig() {
  const cfg = readBiliConfig().config ?? {};
  const raw = cfg.loginKeeper && typeof cfg.loginKeeper === 'object' ? cfg.loginKeeper : {};
  return {
    enabled: raw.enabled !== false,
    intervalHours: positiveHours(raw.intervalHours, DEFAULT_LOGIN_KEEPER.intervalHours),
    autoRefresh: raw.autoRefresh !== false,
    notifyOnRefresh: raw.notifyOnRefresh === true,
  };
}

function readState() {
  const data = readJson(STATE_FILE, null);
  const targets = data && typeof data === 'object' && data.targets && typeof data.targets === 'object' ? data.targets : {};
  return { version: 1, targets };
}

function writeState(state) {
  try { writeJsonAtomic(STATE_FILE, state); } catch { /* 状态写不进去不影响主流程 */ }
}

export function readCredential(target = 'fish') {
  const file = CRED_FILE[target] ?? BILI_CRED;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || !data.sessdata) return null;
    return data;
  } catch {
    return null;
  }
}

/** 只读摘要（给 UI/日志）：绝不返回 sessdata / bili_jct / refreshToken 的值。 */
export function credentialSummary(target = 'fish') {
  const cred = readCredential(target);
  if (!cred) return { configured: false, path: maskPath(CRED_FILE[target] ?? BILI_CRED) };
  return {
    configured: true,
    mid: String(cred.mid ?? ''),
    name: String(cred.name ?? ''),
    savedAt: String(cred.savedAt ?? ''),
    hasRefreshToken: Boolean(String(cred.refreshToken ?? '').trim()),
    refreshTokenAt: String(cred.refreshTokenAt ?? ''),
    refreshedAt: String(cred.refreshedAt ?? ''),
    loginMethod: String(cred.loginMethod ?? ''),
    path: maskPath(CRED_FILE[target] ?? BILI_CRED),
  };
}

/**
 * 写回新 cookie：保留 mid/name/savedAt 等元信息，只替换登录相关字段。
 * refreshToken 只有确实拿到新的时才覆盖（避免 refresh 失败把旧令牌抹掉）。
 */
export function saveRefreshedCredential(target, next, { now = Date.now } = {}) {
  const file = CRED_FILE[target] ?? BILI_CRED;
  const old = readCredential(target) ?? {};
  const payload = {
    ...old,
    sessdata: next.sessdata,
    bili_jct: next.bili_jct,
    buvid3: next.buvid3 || old.buvid3 || '',
    refreshToken: String(next.refreshToken ?? old.refreshToken ?? ''),
    refreshTokenAt: next.refreshToken && next.refreshToken !== old.refreshToken
      ? new Date(now()).toISOString()
      : String(old.refreshTokenAt ?? ''),
    refreshedAt: new Date(now()).toISOString(),
    loginMethod: String(old.loginMethod ?? ''),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows 上无实际作用，忽略 */ }
  return payload;
}

async function notifyOwner({ title, message, log = () => {} }) {
  const result = await callBridge('/api/notify/owner', {
    method: 'POST',
    body: { title, message },
    timeoutMs: 8000,
  });
  if (result.ok && result.data?.ok !== false) return { ok: true, via: 'bridge' };
  log(`[登录守护] 桥接通知失败：${result.error || result.data?.error || result.status}`);
  // 兜底：走 notify.mjs（尊重配置里的 桌面/Webhook/命令；type=none 时等于不推）。
  const notifyMjs = path.join(BILI_TOOLS_DIR, 'commands', 'notify.mjs');
  if (!fs.existsSync(notifyMjs)) return { ok: false, error: result.error || '桥接和 notify.mjs 都不可用' };
  return new Promise((resolve) => {
    execFile(findNodeExe(), [notifyMjs, message, '--title', title], { cwd: BILI_TOOLS_DIR, timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, via: 'notify.mjs', out: String(stdout ?? '').slice(-500), err: String(stderr ?? '').slice(-500) });
    });
  });
}

function notifyMessageFor(status, { target, cred, detail }) {
  const who = TARGET_LABEL[target] ?? target;
  const name = cred?.name ? `${cred.name}（${cred.mid}）` : '账号';
  if (status === 'expired') {
    return {
      title: `B站 登录已失效（${who}）`,
      message: `${name} 的 B站 登录态已经失效（cookie 过期或被踢下线）。\n到「设置 → B站 → B站 账号」重新扫码登录最稳；修好之前 B站 相关自动化会自动跳过，不会刷报错。`,
    };
  }
  if (status === 'no-refresh-token') {
    return {
      title: `B站 登录需要续期（${who}：缺续期令牌）`,
      message: `${name} 的 cookie 到了该续期的时候，但当前凭据是手动粘贴的，没有续期令牌（refresh_token）。\n两种修法（任选其一）：\n① 重新扫码登录一次（推荐，会自动拿到令牌，以后我自动续期）；\n② 打开已登录的 bilibili.com，F12 控制台执行 localStorage.getItem("ac_time_value")，把结果填到「设置 → B站 → 高级设置 → 手动粘贴凭据」的「ac_time_value（续期令牌）」里。\n注意：如果这个号你平时还在浏览器里登录，浏览器也会刷新令牌，可能把这边顶掉；专用号最稳。`,
    };
  }
  if (status === 'refresh-failed') {
    return {
      title: `B站 自动续期失败（${who}）`,
      message: `${name} 的凭据续期失败：${detail || '未知原因'}。\n令牌可能已被别处登录换掉或已过期；重新扫码登录一次即可恢复（扫码会拿到新令牌）。`,
    };
  }
  if (status === 'refreshed') {
    return {
      title: `B站 登录已自动续期（${who}）`,
      message: `${name} 的 B站 登录态已自动续期，不用管。下一次检查按「登录守护」里的间隔继续。`,
    };
  }
  return null;
}

/**
 * 跑一次登录检查（必要时续期）。
 * @returns {ok, status, refresh, refreshed, error, message, state}
 *   status: missing | ok | needs-refresh | no-refresh-token | refreshed | expired | error
 */
export async function runLoginKeeper(options = {}) {
  const {
    target = 'fish', force = false, notify = true, log = () => {},
    now = Date.now, fetchImpl,
  } = options;
  const key = target === 'owner' ? 'owner' : 'fish';
  const cfg = readLoginKeeperConfig();
  const state = readState();
  const entry = { ...(state.targets[key] ?? {}) };
  const cred = readCredential(key);
  const stamp = () => new Date(now()).toISOString();
  const finish = (result) => {
    entry.lastCheckAt = stamp();
    entry.lastStatus = result.status;
    entry.lastError = result.ok ? '' : String(result.error ?? '');
    entry.lastMessage = String(result.message ?? '');
    state.targets[key] = entry;
    writeState(state);
    const nextCheckAt = new Date(now() + cfg.intervalHours * 3600_000).toISOString();
    return { ...result, target: key, checkedAt: entry.lastCheckAt, nextCheckAt, intervalHours: cfg.intervalHours };
  };

  if (!cred) {
    entry.lastStatus = 'missing';
    entry.lastError = '';
    state.targets[key] = entry;
    writeState(state);
    return { ok: false, status: 'missing', target: key, error: '还没有登录凭据', nextCheckAt: new Date(now()).toISOString() };
  }

  // 1) 问 B站：登录还有效吗？该续期吗？
  let info;
  try {
    info = await fetchCookieInfo(cred, { fetchImpl });
  } catch (error) {
    info = { ok: false, code: 'bili.network', error: String(error?.message ?? error) };
  }
  if (!info.ok) {
    const status = info.code === 'bili.cookie-expired' ? 'expired' : 'error';
    const result = finish({ ok: false, status, error: info.error, apiCode: info.apiCode });
    if (notify && (force || status === 'expired')) await maybeNotify(key, entry, status, cfg, { cred, detail: info.error, log, notify, now, state });
    return result;
  }

  if (!info.refresh) {
    const result = finish({ ok: true, status: 'ok', refresh: false });
    return result;
  }

  // 2) 需要续期：有令牌就续，没有就报给用户
  if (!cred.refreshToken) {
    const result = finish({ ok: false, status: 'no-refresh-token', refresh: true, error: '缺少 refresh_token（ac_time_value），无法自动续期' });
    if (notify) await maybeNotify(key, entry, 'no-refresh-token', cfg, { cred, log, notify, now, state });
    return result;
  }
  if (!cfg.autoRefresh && !force) {
    return finish({ ok: true, status: 'needs-refresh', refresh: true });
  }

  let refreshResult;
  try {
    refreshResult = await refreshCookie(cred, { fetchImpl });
  } catch (error) {
    refreshResult = { ok: false, code: 'bili.network', error: String(error?.message ?? error) };
  }
  if (!refreshResult.ok) {
    const status = refreshResult.code === 'bili.no-refresh-token' ? 'no-refresh-token' : 'refresh-failed';
    const result = finish({ ok: false, status, refresh: true, error: refreshResult.error, apiCode: refreshResult.apiCode });
    if (notify) await maybeNotify(key, entry, status, cfg, { cred, detail: refreshResult.error, log, notify, now, state });
    return result;
  }
  if (refreshResult.refreshed === false) {
    return finish({ ok: true, status: 'ok', refresh: false });
  }

  // 3) 先落盘新凭据，再确认旧令牌失效（顺序反了会丢登录）
  let saved;
  try {
    saved = saveRefreshedCredential(key, refreshResult.cred, { now });
  } catch (error) {
    const result = finish({ ok: false, status: 'error', error: `新凭据写盘失败：${String(error?.message ?? error)}` });
    if (notify) await maybeNotify(key, entry, 'refresh-failed', cfg, { cred, detail: result.error, log, notify, now, state });
    return result;
  }
  const confirm = await confirmRefresh(saved, refreshResult.oldRefreshToken, { fetchImpl }).catch((error) => ({
    ok: false, error: String(error?.message ?? error),
  }));
  if (!confirm.ok) log(`[登录守护] 确认更新失败（新凭据已生效，旧令牌未作废）：${confirm.error}`);

  entry.lastRefreshAt = stamp();
  const result = finish({ ok: true, status: 'refreshed', refresh: true, refreshed: true });
  if (notify && cfg.notifyOnRefresh) {
    await maybeNotify(key, entry, 'refreshed', cfg, { cred: saved, log, notify, now, state });
  }
  log(`[登录守护] ${TARGET_LABEL[key]} 登录已自动续期 ✓（下一次检查 ${result.nextCheckAt}）`);
  return result;
}

/** 按 12/24 小时节流发通知；同状态短时间内不重复轰炸。 */
async function maybeNotify(target, entry, status, cfg, { cred, detail, log, now, state }) {
  const gap = NOTIFY_GAP_MS[status] ?? 12 * 3600_000;
  const last = Date.parse(entry.lastNotifyAt ?? '') || 0;
  if (gap > 0 && now() - last < gap) return { ok: false, skipped: 'throttled' };
  const msg = notifyMessageFor(status, { target, cred, detail });
  if (!msg) return { ok: false, skipped: 'no-message' };
  const sent = await notifyOwner({ ...msg, log });
  entry.lastNotifyAt = new Date(now()).toISOString();
  entry.lastNotifyKey = status;
  if (state) writeState(state); // finish() 已经写过一次；通知时间要在之后再落盘
  if (!sent.ok) log(`[登录守护] 通知没发出去：${sent.error || sent.err || '未知原因'}`);
  return sent;
}

/** 到点该检查了吗（定时器用）。 */
export function loginKeeperDue({ target = 'fish', now = Date.now } = {}) {
  const cfg = readLoginKeeperConfig();
  if (!cfg.enabled) return false;
  const cred = readCredential(target);
  if (!cred) return false;
  const state = readState();
  const last = Date.parse(state.targets[target]?.lastCheckAt ?? '') || 0;
  return now() - last >= cfg.intervalHours * 3600_000;
}

/** 设置页只读状态：合并配置 + 凭据摘要 + 上次检查结果，绝不回显令牌。 */
export function loginKeeperStatus({ now = Date.now } = {}) {
  const cfg = readLoginKeeperConfig();
  const state = readState();
  const targets = {};
  for (const target of ['fish', 'owner']) {
    const summary = credentialSummary(target);
    const entry = state.targets[target] ?? {};
    const lastCheck = Date.parse(entry.lastCheckAt ?? '') || 0;
    targets[target] = {
      ...summary,
      lastCheckAt: entry.lastCheckAt ?? '',
      lastRefreshAt: entry.lastRefreshAt ?? '',
      lastStatus: entry.lastStatus ?? (summary.configured ? 'unknown' : 'missing'),
      lastError: entry.lastError ?? '',
      lastMessage: entry.lastMessage ?? '',
      nextCheckAt: lastCheck ? new Date(lastCheck + cfg.intervalHours * 3600_000).toISOString() : (summary.configured ? new Date(now()).toISOString() : ''),
    };
  }
  return {
    ok: true,
    enabled: cfg.enabled,
    intervalHours: cfg.intervalHours,
    autoRefresh: cfg.autoRefresh,
    notifyOnRefresh: cfg.notifyOnRefresh,
    stateFile: maskPath(STATE_FILE),
    targets,
  };
}

/** 手动/定时入口统一收敛异常，调用方不用 try/catch。 */
export async function safeRunLoginKeeper(options = {}) {
  try {
    return await runLoginKeeper(options);
  } catch (error) {
    options.log?.(`[登录守护] 检查异常：${String(error?.message ?? error)}`);
    return { ok: false, status: 'error', error: String(error?.message ?? error) };
  }
}

