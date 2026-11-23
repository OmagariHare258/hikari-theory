#!/usr/bin/env node
// 系统总检：把整套部件按「链路 → 角色/状态 → 安全 → 运维」顺序检查一遍。
// 只读，不改任何配置；出问题用 [FAIL] 标出并返回退出码 1。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DSH_SURFCORE = path.join(HOME, '.dsh', 'surfcore');
const JSON_OUT = process.argv.includes('--json');
const results = [];

function row(section, name, status, detail) {
  results.push({ section, name, status, detail: String(detail ?? '') });
  if (!JSON_OUT) {
    const icon = status === 'ok' ? '[OK]  ' : status === 'warn' ? '[WARN]' : '[FAIL]';
    console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
  }
}
async function checkPort(port, label, required = true) {
  const ok = await new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.end(); resolve(true); });
    socket.setTimeout(1200, () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
  row('链路', label, ok ? 'ok' : required ? 'fail' : 'warn', ok ? `127.0.0.1:${port} 监听` : `127.0.0.1:${port} 未监听`);
  return ok;
}
async function httpJson(url, options = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, body, text };
  } catch (error) {
    return { ok: false, status: 0, body: null, text: String(error?.message ?? error) };
  } finally { clearTimeout(timer); }
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function newestFile(dir, name) {
  try {
    const hits = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const f = path.join(dir, entry.name, name);
      if (fs.existsSync(f)) hits.push({ file: f, mtime: fs.statSync(f).mtimeMs });
    }
    hits.sort((a, b) => b.mtime - a.mtime);
    return hits[0] ?? null;
  } catch { return null; }
}

if (!JSON_OUT) console.log('== SurfCore 系统总检 ==\n');

// 1. 配置
const cfg = readJson(path.join(ROOT, 'config.json'));
if (!cfg) {
  row('配置', 'config.json', 'fail', '读取/解析失败');
} else {
  row('配置', 'config.json', 'ok', `owner=${cfg.ownerQQ || '?'} mode=${cfg.socialV2?.mode || '?'}`);
  const dshUrl = String(cfg.dsh?.baseUrl || '').replace(/\/+$/, '');
  let bridgeLogText = '';
  try { bridgeLogText = fs.readFileSync(path.join(ROOT, 'state', 'bridge.log'), 'utf8'); } catch {}
  const dshReady = /DSH 已就绪/.test(bridgeLogText.split('\n').slice(-2000).join('\n'));
  if (dshReady) {
    row('链路', 'DSH', 'ok', '桥接已报告 DSH 就绪（config baseUrl 可能是旧端口）');
  } else if (dshUrl) {
    const dsh = await httpJson(dshUrl + '/');
    row('链路', 'DSH', dsh.status ? 'ok' : 'warn', dsh.status ? `${dshUrl} 可达` : `${dshUrl} 不可达，且桥接未报告就绪`);
  }
}

// 2. 端口/链路
const bridgePort = Number(cfg?.consolePort) || 3100;
await checkPort(bridgePort, 'SurfCore 控制台');
await checkPort(3000, 'SnowLuma OneBot HTTP');
await checkPort(3001, 'SnowLuma OneBot WS');
await checkPort(5099, 'SnowLuma WebUI', false);
const voice = await httpJson('http://127.0.0.1:8765/v1/health');
if (voice.body?.engines) {
  const gsv = voice.body.engines.find((e) => e.name === 'gsv');
  row('链路', '本地 TTS', gsv?.loaded ? 'ok' : 'warn', gsv?.loaded ? 'voxd + gsv 已加载' : `voxd 在，gsv ${gsv?.error || '未加载'}`);
} else {
  row('链路', '本地 TTS', 'warn', voice.text.slice(0, 80));
}

// 3. SnowLuma 账号
if (cfg?.snowluma?.httpUrl && cfg?.snowluma?.accessToken) {
  const u = String(cfg.snowluma.httpUrl).replace(/\/+$/, '') + '/get_login_info?access_token=' + encodeURIComponent(cfg.snowluma.accessToken);
  const login = await httpJson(u);
  const uin = String(login.body?.data?.user_id || '');
  row('链路', 'QQ 登录', uin ? 'ok' : 'fail', uin ? `${uin} ${login.body?.data?.nickname || ''}`.trim() : '未登录/网关未响应');
  if (uin && cfg.snowluma.expectedUin && uin !== String(cfg.snowluma.expectedUin)) {
    row('链路', 'QQ 账号一致性', 'warn', `期望 ${cfg.snowluma.expectedUin}，实际 ${uin}`);
  }
} else {
  row('链路', 'QQ 登录', 'warn', 'config 缺少 snowluma.httpUrl/accessToken');
}

// 4. 角色/状态
const charDir = path.join(DSH_SURFCORE, 'characters');
const persona = newestFile(charDir, 'persona.md');
if (persona) {
  const daily = path.join(path.dirname(persona.file), 'persona.daily.md');
  row('角色', '人格卡', 'ok', `${path.basename(path.dirname(persona.file))} · ${fs.statSync(persona.file).size} 字节`);
  row('角色', '状态层', fs.existsSync(daily) ? 'ok' : 'warn', fs.existsSync(daily) ? '存在' : '缺少 persona.daily.md');
} else {
  row('角色', '人格卡', 'fail', '找不到当前角色 persona.md');
}
const unifiedCfg = readJson(path.join(DSH_SURFCORE, 'config.json'));
const maxChars = Number(unifiedCfg?.memoryCard?.maxChars) || 60000;
const memCard = newestFile(charDir, path.join('memory', 'memory-card.md'));
if (memCard) {
  const chars = fs.readFileSync(memCard.file, 'utf8').length;
  const pct = Math.round((chars / maxChars) * 1000) / 10;
  row('状态', '记忆卡', pct >= 100 ? 'fail' : pct >= 90 ? 'warn' : 'ok', `${chars}/${maxChars} 字（${pct}%）`);
} else {
  row('状态', '记忆卡', 'warn', '找不到 memory-card.md');
}
const coreState = path.join(ROOT, 'state', 'core-state.md');
if (fs.existsSync(coreState)) {
  const ageMin = Math.round((Date.now() - fs.statSync(coreState).mtimeMs) / 60000);
  row('状态', '核心状态', ageMin <= 35 ? 'ok' : 'warn', `更新于 ${ageMin} 分钟前`);
} else {
  row('状态', '核心状态', 'warn', '还没有 core-state.md');
}
try {
  const lifeMod = await import('file:///' + path.join(ROOT, 'src', 'life-sim.js').replace(/\\/g, '/'));
  const life = lifeMod.lifeState(Date.now(), 'health');
  row('状态', '生活模拟', 'ok', `${life.sleeping ? '在睡' : life.napping ? '午睡' : life.meal ? '在吃' : '醒着'} · 精力 ${life.energy}/100 · 延迟 ${Math.round(lifeMod.lifeDelayMs(Date.now(), 'health') / 1000)}s`);
} catch (error) {
  row('状态', '生活模拟', 'warn', String(error?.message ?? error));
}
const privacy = readJson(path.join(ROOT, 'state', 'privacy.json'));
row('安全', '隐私词表', privacy ? 'ok' : 'warn', privacy ? `${(privacy.terms || []).length} 个词条` : '缺少 state/privacy.json');
row('安全', '跨会话共享记忆', fs.existsSync(path.join(ROOT, 'state', 'shared-memory.json')) ? 'ok' : 'warn', fs.existsSync(path.join(ROOT, 'state', 'shared-memory.json')) ? '存在' : '未初始化，首次写入后生成');
for (const [name, rel] of [['MCP 安全工具', 'src/mcp-snowluma-safe.js'], ['生活模拟', 'src/life-sim.js'], ['管理端工具', 'src/mcp-host-server.js']]) {
  row('安全', name, fs.existsSync(path.join(ROOT, rel)) ? 'ok' : 'fail', rel);
}

// 5. 运维
const startup = path.join(HOME, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'SnowLuma.lnk');
row('运维', 'SnowLuma 自启', fs.existsSync(startup) ? 'ok' : 'warn', startup);
const logFile = path.join(ROOT, 'state', 'bridge.log');
if (fs.existsSync(logFile)) {
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-800);
  const now = new Date();
  const recent = lines.filter((line) => {
    const m = /^(\d{2}):(\d{2}):(\d{2})/.exec(line);
    if (!m) return true;
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]), Number(m[3])).getTime();
    return now.getTime() - at <= 60 * 60 * 1000;
  });
  const errors = recent.filter((line) => /错误|失败|TURN_REPEATED|token 无效/.test(line) && !/同步收藏表情失败|WebSocket closed before opening|SnowLuma 错误：{}/.test(line));
  row('运维', '近期桥接错误', errors.length ? 'warn' : 'ok', errors.length ? `${errors.length} 条（最后：${errors[errors.length - 1].slice(0, 80)}）` : '最近 400 行无错误');
} else {
  row('运维', '桥接日志', 'warn', '找不到 bridge.log');
}

const fails = results.filter((r) => r.status === 'fail');
const warns = results.filter((r) => r.status === 'warn');
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: fails.length === 0, fails: fails.length, warns: warns.length, results }, null, 2));
} else {
  console.log(`\n== 结果：${fails.length ? 'FAIL' : warns.length ? 'WARN' : 'OK'}（FAIL ${fails.length} / WARN ${warns.length}）==`);
}
process.exit(fails.length ? 1 : 0);
