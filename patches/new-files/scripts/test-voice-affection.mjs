// 语音好感度门槛：分数读取 / 解锁判定 / 低频冷却与每日上限 / 记账跨天。
// 纯逻辑 + 临时文件，不联网、不启动桥接。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  DEFAULT_VOICE_AFFECTION, affectionLookup, loadAffection, loadVoiceAffectionState,
  localDayKey, normalizeVoiceAffection, noteVoiceAffectionSent, saveVoiceAffectionState,
  voiceAffectionDecision, voiceAffectionStateFile, voiceAffectionUsage,
} = await import('../src/voice-affection.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-voice-affection-'));
const affectionFile = path.join(tmp, 'affection.json');
const stateFile = path.join(tmp, 'state', 'voice-affection.json');
const day = localDayKey();

// ── ① 配置归一 ─────────────────────────────────────────────────────────────
assert.deepEqual(normalizeVoiceAffection(undefined), {
  enabled: true,
  fullAt: DEFAULT_VOICE_AFFECTION.fullAt,
  lowCooldownHours: DEFAULT_VOICE_AFFECTION.lowCooldownHours,
  lowMaxPerDay: DEFAULT_VOICE_AFFECTION.lowMaxPerDay,
  lowWindowMinutes: DEFAULT_VOICE_AFFECTION.lowWindowMinutes,
  unknownScore: DEFAULT_VOICE_AFFECTION.unknownScore,
});
assert.equal(normalizeVoiceAffection({ enabled: false }).enabled, false);
assert.equal(normalizeVoiceAffection({ fullAt: 999 }).fullAt, 100, '门槛上限 100');
assert.equal(normalizeVoiceAffection({ fullAt: -5 }).fullAt, 0);
assert.equal(normalizeVoiceAffection({ lowCooldownHours: 999 }).lowCooldownHours, 168);
assert.equal(normalizeVoiceAffection({ lowMaxPerDay: -1 }).lowMaxPerDay, 0);
assert.equal(normalizeVoiceAffection({ lowWindowMinutes: 0 }).lowWindowMinutes, 1);

// ── ② 好感度读取 ───────────────────────────────────────────────────────────
assert.deepEqual(loadAffection(affectionFile), { people: {}, ownerFloor: 75, updatedAt: '' }, '文件不存在时为空表');
fs.writeFileSync(affectionFile, JSON.stringify({
  updatedAt: '2026-11-05 14:10:07',
  ownerFloor: 75,
  people: {
    '10000001': { name: '主人', score: 100, band: '最喜欢' },
    '2781448117': { name: '群友D', score: 59, band: '朋友' },
    '10000002': { name: '群友E', score: 54, band: '朋友' },
    broken: { name: '坏键', score: 80 },
  },
}), 'utf8');
const affection = loadAffection(affectionFile);
assert.equal(affection.people['2781448117'].score, 59);
assert.equal(affection.people.broken, undefined, '非 QQ 号的键不能进名单');
assert.equal(affection.ownerFloor, 75);

const owner = affectionLookup(affection, '10000001', { ownerQQ: '10000001' });
assert.equal(owner.isOwner, true);
assert.equal(owner.score, 100);
assert.equal(owner.name, '主人');

const lowGuy = affectionLookup(affection, '2781448117', { ownerQQ: '10000001' });
assert.equal(lowGuy.score, 59);
assert.equal(lowGuy.known, true);

const stranger = affectionLookup(affection, '999999', { ownerQQ: '10000001', unknownScore: 40 });
assert.equal(stranger.score, 40, '名单外的人按 unknownScore');
assert.equal(stranger.known, false);

// 主人即使文件里分数低，也按 ownerFloor 兜底（affection.ps1 的硬地板）
const lowOwnerFile = path.join(tmp, 'affection-lowowner.json');
fs.writeFileSync(lowOwnerFile, JSON.stringify({ ownerFloor: 75, people: { '111': { score: 10 } } }), 'utf8');
assert.equal(affectionLookup(loadAffection(lowOwnerFile), '111', { ownerQQ: '111' }).score, 75);

// 坏文件：不抛错，退回空表
const badFile = path.join(tmp, 'bad.json');
fs.writeFileSync(badFile, '{not json', 'utf8');
assert.deepEqual(loadAffection(badFile).people, {});

// ── ③ 判定：≥门槛解锁 / <门槛低频 ─────────────────────────────────────────
const gate = normalizeVoiceAffection({ fullAt: 60, lowCooldownHours: 6, lowMaxPerDay: 2 });
const now = Date.now();

assert.equal(voiceAffectionDecision({ score: 60, gate, now }).tier, 'full', '正好 60 应解锁');
assert.equal(voiceAffectionDecision({ score: 100, gate, now }).tier, 'full');
assert.equal(voiceAffectionDecision({ score: 59, gate, now, dayCount: 0, lastAt: 0 }).tier, 'low', '59 走低频，但仍允许');

const cooled = voiceAffectionDecision({ score: 59, gate, now, dayCount: 1, lastAt: now - 2 * 3600_000 });
assert.equal(cooled.tier, 'blocked');
assert.equal(cooled.allowed, false);
assert.match(cooled.reason, /小时|冷却/);

const fresh = voiceAffectionDecision({ score: 59, gate, now, dayCount: 1, lastAt: now - 7 * 3600_000 });
assert.equal(fresh.tier, 'low', '过了冷却就恢复低频可用');

const capped = voiceAffectionDecision({ score: 59, gate, now, dayCount: 2, lastAt: now - 7 * 3600_000 });
assert.equal(capped.tier, 'blocked');
assert.match(capped.reason, /每天最多|额度/);

// 门槛关掉：一律放行（旧行为），不再卡低频
const off = normalizeVoiceAffection({ enabled: false });
assert.equal(voiceAffectionDecision({ score: 0, gate: off, now, dayCount: 99 }).tier, 'full');

// 每日上限 0 表示不设上限
const noCap = normalizeVoiceAffection({ lowMaxPerDay: 0 });
assert.equal(voiceAffectionDecision({ score: 0, gate: noCap, now, dayCount: 50, lastAt: 0 }).tier, 'low');

// ── ④ 记账：跨天清零、冷却保留 ─────────────────────────────────────────────
let state = loadVoiceAffectionState(stateFile);
assert.deepEqual(state.people, {}, '状态文件不存在时为空');
state = noteVoiceAffectionSent(state, '2781448117', now);
assert.equal(state.people['2781448117'].dayCount, 1);
assert.equal(state.people['2781448117'].day, day);
state = noteVoiceAffectionSent(state, '2781448117', now);
assert.equal(state.people['2781448117'].dayCount, 2, '同一天再记一次应累加');
assert.equal(state.people['2781448117'].day, day);
saveVoiceAffectionState(stateFile, state);
const reloaded = loadVoiceAffectionState(stateFile);
assert.equal(reloaded.people['2781448117'].dayCount, 2);
assert.ok(reloaded.people['2781448117'].lastAt > 0);

// 昨天的记录：dayCount 归零，但 lastAt 还在（冷却仍生效）
const yesterday = { version: 1, people: { '2781448117': { lastAt: now - 3 * 3600_000, day: '2000-01-01', dayCount: 5 } } };
const usage = voiceAffectionUsage(yesterday, '2781448117', now);
assert.equal(usage.dayCount, 0, '跨天每日条数清零');
assert.equal(usage.lastAt, now - 3 * 3600_000, '上次发送时间保留（冷却用）');
assert.equal(voiceAffectionUsage(yesterday, '999', now).dayCount, 0);

// 非 QQ 号不记账（防脏键）
state = noteVoiceAffectionSent({ version: 1, people: {} }, 'abc');
assert.deepEqual(state.people, {});

// 路径约定：state/voice-affection.json
assert.equal(voiceAffectionStateFile(path.join(tmp, 'state')).endsWith('voice-affection.json'), true);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log('OK test-voice-affection');

