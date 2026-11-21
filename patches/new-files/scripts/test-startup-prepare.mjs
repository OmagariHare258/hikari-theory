// 「DSH 启动准备」：配置归一（组件/延迟/语音包）+ 接线契约（插件启动时自动跑、概览可开关）。
// 纯函数与静态契约，不启动 DSH / 不联网。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { DEFAULT_STARTUP, normalizeStartupConfig } = await import('../plugins/surfcore/lib/store.js');

// ── ① 默认值 ───────────────────────────────────────────────────────────────
assert.equal(DEFAULT_STARTUP.enabled, true, '默认开启');
assert.deepEqual(DEFAULT_STARTUP.components, ['qq', 'bili', 'voice'], '默认顺序 QQ → B站 → 语音');
assert.equal(DEFAULT_STARTUP.voicePack, 'voice-local');

// ── ② 配置归一 ─────────────────────────────────────────────────────────────
const d = normalizeStartupConfig(undefined);
assert.equal(d.enabled, true);
assert.deepEqual(d.components, ['qq', 'bili', 'voice']);
assert.equal(d.voicePack, 'voice-local');
assert.equal(d.delayMs, 8000);

assert.equal(normalizeStartupConfig({ enabled: false }).enabled, false);
assert.deepEqual(normalizeStartupConfig({ components: ['voice', 'qq', 'voice', 'bogus'] }).components, ['voice', 'qq'], '去重 + 丢弃未知组件');
assert.deepEqual(normalizeStartupConfig({ components: [] }).components, ['qq', 'bili', 'voice'], '空数组回默认，不会变成「什么都不启动」');
assert.equal(normalizeStartupConfig({ voicePack: 'voice-cloud' }).voicePack, 'voice-cloud');
assert.equal(normalizeStartupConfig({ voicePack: 'weird' }).voicePack, 'voice-local', '未知语音包回本地');
assert.equal(normalizeStartupConfig({ delayMs: 0 }).delayMs, 3000, '延迟下限 3 秒');
assert.equal(normalizeStartupConfig({ delayMs: 999999 }).delayMs, 120000, '延迟上限 120 秒');
assert.equal(normalizeStartupConfig({ delayMs: 12345.7 }).delayMs, 12346, '四舍五入取整');

// ── ③ 插件接线：启动时自动跑 + 顺序 + 幂等 + 概览接口 ─────────────────────
const indexSrc = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/index.js'), 'utf8');
assert.match(indexSrc, /scheduleStartupPrepare\(\);/, '插件激活时会安排启动准备');
assert.match(indexSrc, /function scheduleStartupPrepare\(/, '有 scheduleStartupPrepare');
assert.match(indexSrc, /function runStartupPrepare\(/, '有 runStartupPrepare');
assert.match(indexSrc, /const STARTUP_COMPONENTS = \['qq', 'bili', 'voice'\]/, '组件顺序 QQ → B站 → 语音');
assert.match(indexSrc, /function waitForBridgeUp\(/, '语音启动前等桥接就绪（语音包由桥接托管）');
assert.match(indexSrc, /\$\{API_PREFIX\}\/startup/, '有 /startup 接口');
assert.match(indexSrc, /if \(cfg\.enabled === false/, '关掉开关就不自动跑');
assert.match(indexSrc, /startupComponentReady\(id, status\)/, '已在跑就跳过（幂等）');
assert.match(indexSrc, /if \(startupPrepareTimer\) \{ clearTimeout\(startupPrepareTimer\)/, '销毁时清掉定时器');
assert.match(indexSrc, /startComponent\(id, \{ voicePack \}\)/, '复用一键启动的 startComponent');

// ── ④ 设置页：开关 + 立即准备 + 上次结果 ──────────────────────────────────
const clientSrc = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/client.js'), 'utf8');
assert.match(clientSrc, /\["startup", "enabled"\]/, '概览有启动准备开关（写 unified.startup.enabled）');
assert.match(clientSrc, /api\("\/startup"/, '概览能读/触发启动准备');
assert.match(clientSrc, /DSH 启动准备（自动）/, '概览有对应分组标题');
assert.match(clientSrc, /立即准备一次/, '有手动立即准备按钮');

// ── ④b 语音包启动：detached 启动器 exit 0 不能被当成失败 ────────────────────
// 本地包 run.bat 用 `start "" /b pythonw ...` 拉起服务后自己立刻退出；
// 旧逻辑「进程退出就 break」会误报 VOICE_START_EXITED（2026-11-05 实测）。
const voicePacksSrc = fs.readFileSync(path.join(root, 'src/voice-packs.js'), 'utf8');
assert.match(voicePacksSrc, /exitCode !== null && exitCode !== 0/, 'exit 0 继续等端口，只有非 0 才提前失败');
assert.match(voicePacksSrc, /exitCode === null \|\| exitCode === 0/, 'detached 启动器退出但端口没起来时按超时报');

// ── ⑤ 统一配置默认值里有 startup（readUnified 会合并）─────────────────────
const storeSrc = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/store.js'), 'utf8');
assert.match(storeSrc, /startup: DEFAULT_STARTUP/, 'DEFAULT_UNIFIED 带 startup 默认值');
assert.match(storeSrc, /config\.startup = normalizeStartupConfig\(config\.startup\)/, 'readUnified 归一 startup');
assert.match(storeSrc, /next\.startup = normalizeStartupConfig\(next\.startup\)/, 'saveUnified 归一 startup');

console.log('OK test-startup-prepare');

