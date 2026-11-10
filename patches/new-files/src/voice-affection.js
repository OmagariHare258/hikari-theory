/**
 * 语音的「好感度门槛」纯逻辑（2026-11-05 用户要求）。
 *
 * 规则：
 *   · 好感度 ≥ fullAt（默认 60）：解锁完全语音功能 —— 语音可以正常用；
 *   · 好感度 < fullAt：频率大幅减少 —— 同一个人冷却 lowCooldownHours、每天最多 lowMaxPerDay 条，
 *     且必须是他刚说过话（回给他的场景）才允许；
 *   · 名单里没有的人按 40 分（和人格卡日常层的口径一致，见 docs/cases/…）；
 *   · 不管分数多少，语音都是「需要才发」：这一层只负责能不能发，发不发由提示词约束。
 *
 * 这个模块不碰网络、不碰桥接状态，只读写：
 *   · characters/<id>/affection.json  —— 好感度（由 state/tools/affection.ps1 生成）
 *   · state/voice-affection.json      —— 本模块自己的记账（每人上次发语音时间 / 当天条数）
 *
 * 注意：affection.json 是**角色级**文件，换角色要重新读；缓存按 mtime 失效。
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_VOICE_AFFECTION = {
  enabled: true,
  fullAt: 60,             // ≥ 这个分数：完全解锁
  lowCooldownHours: 6,    // < 门槛：同一个人至少隔多少小时
  lowMaxPerDay: 2,        // < 门槛：同一个人每天最多几条
  lowWindowMinutes: 10,   // < 门槛：必须是他最近多少分钟内说过话（回给他的场景）
  unknownScore: 10,       // 名单里没有的人＝陌生人（和 affection.ps1 的 <10 分档一致）
};

function intInRange(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 配置归一：UI/手改 JSON 都可能传奇怪的值。 */
export function normalizeVoiceAffection(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: raw.enabled !== false,
    fullAt: intInRange(raw.fullAt, DEFAULT_VOICE_AFFECTION.fullAt, 0, 100),
    lowCooldownHours: intInRange(raw.lowCooldownHours, DEFAULT_VOICE_AFFECTION.lowCooldownHours, 0, 168),
    lowMaxPerDay: intInRange(raw.lowMaxPerDay, DEFAULT_VOICE_AFFECTION.lowMaxPerDay, 0, 50),
    lowWindowMinutes: intInRange(raw.lowWindowMinutes, DEFAULT_VOICE_AFFECTION.lowWindowMinutes, 1, 120),
    unknownScore: intInRange(raw.unknownScore, DEFAULT_VOICE_AFFECTION.unknownScore, 0, 100),
  };
}

// ── affection.json（带 mtime 缓存）─────────────────────────────────────────
let affectionCache = { file: '', sig: '', data: { people: {}, ownerFloor: 75, updatedAt: '' } };

/**
 * 读好感度文件。文件不存在/坏掉时返回空表（所有未知的人按 unknownScore 处理），不抛错。
 * 返回 { people: { '<qq>': {name, score, band} }, ownerFloor, updatedAt }
 */
export function loadAffection(file) {
  const target = String(file ?? '');
  if (!target) return { people: {}, ownerFloor: 75, updatedAt: '' };
  let sig = 'missing';
  try {
    const stat = fs.statSync(target);
    sig = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return { people: {}, ownerFloor: 75, updatedAt: '' };
  }
  if (affectionCache.file === target && affectionCache.sig === sig) return affectionCache.data;
  let data = { people: {}, ownerFloor: 75, updatedAt: '' };
  try {
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    const people = {};
    for (const [qq, item] of Object.entries(raw?.people ?? {})) {
      const score = Number(item?.score);
      if (!/^\d+$/.test(String(qq)) || !Number.isFinite(score)) continue;
      people[String(qq)] = {
        name: String(item?.name ?? ''),
        score: Math.min(100, Math.max(0, Math.round(score))),
        band: String(item?.band ?? ''),
        // 群关系/时间：群聊「本群印象」要用；旧文件没有就留空。
        lastSeen: String(item?.lastSeen ?? ''),
        groups: Array.isArray(item?.groups)
          ? item.groups.map((g) => String(g)).filter((g) => /^\d{4,20}$/.test(g)).slice(0, 20)
          : [],
      };
    }
    data = { people, ownerFloor: Number(raw?.ownerFloor) || 75, updatedAt: String(raw?.updatedAt ?? '') };
  } catch {
    data = { people: {}, ownerFloor: 75, updatedAt: '' };
  }
  affectionCache = { file: target, sig, data };
  return data;
}

/** 查某个人的好感度；主人至少按 ownerFloor 算，名单外的人按 unknownScore。 */
export function affectionLookup(affection, userId, { ownerQQ = '', unknownScore = DEFAULT_VOICE_AFFECTION.unknownScore } = {}) {
  const id = String(userId ?? '').trim();
  const people = affection?.people ?? {};
  const entry = people[id] ?? null;
  const isOwner = Boolean(id) && String(ownerQQ ?? '') === id;
  const floor = Number(affection?.ownerFloor) || 75;
  const base = entry ? entry.score : Number(unknownScore) || DEFAULT_VOICE_AFFECTION.unknownScore;
  const score = isOwner ? Math.max(base, floor) : base;
  return {
    userId: id,
    score,
    known: Boolean(entry),
    isOwner,
    name: entry?.name ? String(entry.name) : '',
    band: entry?.band ? String(entry.band) : '',
  };
}

/** 本地日期（Asia/Shanghai 等本机时区）：用于「每天最多几条」。 */
export function localDayKey(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 判断这次能不能发语音。
 * @returns {{tier:'full'|'low'|'blocked', allowed:boolean, reason:string}}
 */
export function voiceAffectionDecision({ score, gate, now = Date.now(), lastAt = 0, dayCount = 0 } = {}) {
  const g = normalizeVoiceAffection(gate);
  if (!g.enabled) return { tier: 'full', allowed: true, reason: '' };
  if (Number(score) >= g.fullAt) return { tier: 'full', allowed: true, reason: '' };
  if (g.lowMaxPerDay > 0 && dayCount >= g.lowMaxPerDay) {
    return {
      tier: 'blocked', allowed: false,
      reason: `好感度 ${score} 低于 ${g.fullAt}，今天给这个人的语音额度已经用完（每天最多 ${g.lowMaxPerDay} 条），用文字回`,
    };
  }
  const cooldownMs = g.lowCooldownHours * 3600_000;
  if (cooldownMs > 0 && lastAt && now - lastAt < cooldownMs) {
    const leftMin = Math.ceil((cooldownMs - (now - lastAt)) / 60_000);
    return {
      tier: 'blocked', allowed: false,
      reason: `好感度 ${score} 低于 ${g.fullAt}，语音要少用：同一个人 ${g.lowCooldownHours} 小时内最多一条（还有约 ${leftMin} 分钟），这次用文字`,
    };
  }
  return { tier: 'low', allowed: true, reason: '' };
}

// ── state/voice-affection.json（薄记账，坏掉就重置）────────────────────────
export function voiceAffectionStateFile(stateDir) {
  return path.join(String(stateDir), 'voice-affection.json');
}

export function loadVoiceAffectionState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const people = {};
    for (const [qq, item] of Object.entries(raw?.people ?? {})) {
      if (!/^\d+$/.test(String(qq))) continue;
      people[String(qq)] = {
        lastAt: Number(item?.lastAt) || 0,
        day: String(item?.day ?? ''),
        dayCount: Number(item?.dayCount) || 0,
      };
    }
    return { version: 1, people };
  } catch {
    return { version: 1, people: {} };
  }
}

export function saveVoiceAffectionState(file, state) {
  const payload = { version: 1, updatedAt: new Date().toISOString(), people: state?.people ?? {} };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch { /* 记账失败不影响发送本身 */ }
}

/** 记一次「给这个人发过语音」：顺带做跨天清零。 */
export function noteVoiceAffectionSent(state, userId, now = Date.now()) {
  const id = String(userId ?? '').trim();
  if (!/^\d+$/.test(id)) return state;
  const day = localDayKey(now);
  const prev = state.people[id] ?? { lastAt: 0, day: '', dayCount: 0 };
  state.people[id] = {
    lastAt: now,
    day,
    dayCount: prev.day === day ? (Number(prev.dayCount) || 0) + 1 : 1,
  };
  return state;
}

/** 读某个人今天的用量（dayCount 跨天自动归零，但 lastAt 保留用于冷却）。 */
export function voiceAffectionUsage(state, userId, now = Date.now()) {
  const id = String(userId ?? '').trim();
  const rec = state?.people?.[id] ?? {};
  const day = localDayKey(now);
  return {
    lastAt: Number(rec.lastAt) || 0,
    dayCount: rec.day === day ? Number(rec.dayCount) || 0 : 0,
  };
}

