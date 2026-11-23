// 生活模拟：把「困、刚醒、吃饭、深夜」等状态做成桥接内部的时间层。
// 只影响语气、回复延迟和主动行为；绝不把作息当台词播报。

const DAY_MS = 24 * 60 * 60 * 1000;

function hashCode(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minutesOfDay(now) {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

function hhmm(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function inWindow(nowMin, start, end) {
  if (start === end) return false;
  if (start < end) return nowMin >= start && nowMin < end;
  return nowMin >= start || nowMin < end;
}

/** 每天一套轻微波动的作息，同一天内稳定。 */
function planFor(now, characterId) {
  const key = dayKey(now);
  const rand = mulberry32(hashCode(`${characterId}|${key}|life`));
  // 0=早睡早起，1=正常，2=晚睡晚起，3=乱七八糟
  const style = Math.floor(rand() * 4);
  const sleepStart = 23 * 60 + 30 + (style === 0 ? -75 : style === 2 ? 105 : style === 3 ? -60 + Math.round(rand() * 180) : -15 + Math.round(rand() * 60));
  const sleepHours = 5.8 + rand() * 2.6; // 5.8–8.4h
  const wake = sleepStart + sleepHours * 60;
  const napChance = rand();
  const napStart = 12 * 60 + 50 + Math.round(rand() * 70);
  const napMinutes = napChance < 0.55 ? 0 : 15 + Math.round(rand() * 45);
  const breakfast = 7 * 60 + 15 + Math.round(rand() * 50);
  const lunch = 12 * 60 + 5 + Math.round(rand() * 45);
  const dinner = 18 * 60 + 5 + Math.round(rand() * 55);
  const energyBias = Math.round((rand() - 0.5) * 24);
  return {
    key,
    style,
    sleepStart,
    sleepEnd: ((wake % 1440) + 1440) % 1440,
    sleepHours,
    napStart,
    napEnd: napStart + napMinutes,
    breakfast,
    lunch,
    dinner,
    energyBias,
    // 每天第一次唤醒后的困倦程度也有波动
    grog: 0.7 + rand() * 0.6,
  };
}

function near(nowMin, at, minutes) {
  const diff = Math.abs(nowMin - at);
  return diff <= minutes || diff >= 1440 - minutes;
}

function energyOf(plan, now, nowMin) {
  let e = 72 + plan.energyBias;
  if (inWindow(nowMin, plan.sleepStart, plan.sleepEnd)) {
    return Math.round(Math.max(8, 22 + plan.energyBias * 0.4));
  }
  const wakeMin = ((plan.sleepEnd % 1440) + 1440) % 1440;
  let awakeMin = nowMin - wakeMin;
  if (awakeMin < 0) awakeMin += 1440;
  e -= Math.min(40, awakeMin * 0.035);
  if (plan.napEnd > plan.napStart && inWindow(nowMin, plan.napStart, plan.napEnd)) {
    e = Math.min(100, e + 22);
  } else if (plan.napEnd > plan.napStart && nowMin >= plan.napEnd && nowMin < plan.napEnd + 40) {
    e = Math.min(100, e + 16);
  }
  if (near(nowMin, plan.breakfast, 35) || near(nowMin, plan.lunch, 40) || near(nowMin, plan.dinner, 45)) e += 8;
  if (nowMin >= 23 * 60 + 30 || nowMin < 4 * 60 + 30) e -= 18;
  else if (nowMin >= 13 * 60 && nowMin < 15 * 60) e -= 8;
  else if (nowMin >= 6 * 60 && nowMin < 8 * 60) e -= 6;
  return Math.max(5, Math.min(100, Math.round(e)));
}

function buildState(now, characterId) {
  const plan = planFor(now, characterId);
  const nowMin = minutesOfDay(now);
  const sleeping = inWindow(nowMin, plan.sleepStart, plan.sleepEnd);
  const napping = plan.napEnd > plan.napStart && inWindow(nowMin, plan.napStart, plan.napEnd);
  const wakeMin = ((plan.sleepEnd % 1440) + 1440) % 1440;
  let sinceWake = nowMin - wakeMin;
  if (sinceWake < 0) sinceWake += 1440;
  const justWoke = !sleeping && sinceWake >= 0 && sinceWake <= 25;
  const meal = near(nowMin, plan.breakfast, 25) || near(nowMin, plan.lunch, 30) || near(nowMin, plan.dinner, 35);
  const lateNight = nowMin >= 23 * 60 + 15 || nowMin < 4 * 60 + 30;
  const energy = energyOf(plan, now, nowMin);
  const busy = sleeping || napping || meal;
  return {
    plan,
    nowMin,
    sleeping,
    napping,
    meal,
    justWoke,
    lateNight,
    energy,
    busy,
    sleepLabel: `${hhmm(plan.sleepStart)}–${hhmm(plan.sleepEnd)}`,
  };
}

function delayFor(state, now, characterId) {
  const rand = mulberry32(hashCode(`${characterId}|${dayKey(now)}|${Math.floor(now / 60000)}|delay`));
  if (state.sleeping) return 25_000 + Math.round(rand() * 35_000);
  if (state.napping) return 15_000 + Math.round(rand() * 25_000);
  if (state.justWoke) return 8_000 + Math.round(rand() * 12_000);
  if (state.meal) return 4_000 + Math.round(rand() * 7_000);
  if (state.energy <= 25 || state.lateNight) return 3_000 + Math.round(rand() * 6_000);
  return 0;
}

function promptFor(state) {
  // 只在“有感觉”的时候注入；平时不注入，避免把作息变成台词。
  if (state.sleeping) {
    return '【身体状态】你很困，脑子发沉，耐心也不多。只影响语气和速度：短、慢、别热情；不要主动说自己困或在睡觉，也不要解释为什么回得慢。';
  }
  if (state.napping) {
    return '【身体状态】没睡够，懵，有点不情愿。短、慢；不要报「我在午睡」。';
  }
  if (state.justWoke) {
    return '【身体状态】刚醒，还没完全缓过来。短、慢一点，别太精神；不要提自己刚睡醒。';
  }
  if (state.lateNight) {
    return '【身体状态】很晚了，困，耐心少。短、别主动开话题；不要报时间，也不要说「该睡了」。';
  }
  if (state.meal) {
    return '【身体状态】正在吃东西，手上/嘴上不利索。短一点；不要提「在吃饭」。';
  }
  if (state.energy <= 25) {
    return '【身体状态】有点累，不想多动。短、少铺陈；不要解释原因。';
  }
  return '';
}

export function lifeState(now = Date.now(), characterId = 'default') {
  return buildState(now, characterId);
}

export function lifePromptLine(now = Date.now(), characterId = 'default') {
  const state = buildState(now, characterId);
  return promptFor(state);
}

export function lifeDelayMs(now = Date.now(), characterId = 'default') {
  return delayFor(buildState(now, characterId), now, characterId);
}

export function lifeBusy(now = Date.now(), characterId = 'default') {
  return buildState(now, characterId).busy;
}

export const __life = { planFor, buildState, promptFor, delayFor, hhmm };
