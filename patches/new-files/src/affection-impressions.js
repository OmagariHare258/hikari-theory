/**
 * 「本群印象」：群聊里按人显示好感度（2026-11-05 用户要求）。
 *
 * 数据来自 characters/<id>/affection.json（state/tools/affection.ps1 生成）：
 *   people[qq] = { name, score, band, lastSeen, ..., groups:[群号] }
 * 这里只做筛选/排序/排版，不读网络、不写文件，方便单测。
 *
 * 规则：
 *   · 只列「有印象」的人：score ≥ 10（<10 就是陌生人，不再点名）；
 *   · 只列出现在**当前群**的人（groups 里有这个群号）；
 *   · 最多 12 个，按分数从高到低；
 *   · 名单里没有的人按陌生人对待（礼貌、保持距离）。
 */

export const IMPRESSION_MIN_SCORE = 10;
export const IMPRESSION_MAX = 12;

/** 某个群里「她有印象的人」，按分数降序。 */
export function friendsInGroup(affection, groupId, { minScore = IMPRESSION_MIN_SCORE, max = IMPRESSION_MAX } = {}) {
  const gid = String(groupId ?? '').trim();
  if (!gid) return [];
  const people = affection?.people ?? {};
  const rows = [];
  for (const [qq, person] of Object.entries(people)) {
    const groups = Array.isArray(person?.groups) ? person.groups.map(String) : [];
    if (!groups.includes(gid)) continue;
    const score = Number(person?.score);
    if (!Number.isFinite(score) || score < minScore) continue;
    rows.push({
      qq,
      name: String(person?.name || qq).slice(0, 16),
      score: Math.round(score),
      band: String(person?.band || ''),
      lastSeen: String(person?.lastSeen || ''),
    });
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return rows.slice(0, Math.max(1, Number(max) || IMPRESSION_MAX));
}

/**
 * 唤醒提示词里的那一行；没有可列的人时返回空串（不占 token）。
 * 例：`【本群印象】sensei 100/100（最喜欢）｜群友D 59/100（朋友）；没列到的人＝陌生人（礼貌、保持距离，不主动熟络）。`
 */
export function formatGroupImpressionsLine(affection, groupId, opts = {}) {
  const rows = friendsInGroup(affection, groupId, opts);
  if (!rows.length) return '';
  const list = rows.map((r) => `${r.name} ${r.score}/100${r.band ? `（${r.band}）` : ''}`).join('｜');
  return `【本群印象】${list}；没列到的人＝陌生人（礼貌、保持距离，不主动熟络）。\n\n`;
}

/** 好感度分档（和 affection.ps1 的 Band() 保持一致）。 */
export function affectionBand(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return '陌生人';
  if (s >= 81) return '最喜欢';
  if (s >= 61) return '亲近';
  if (s >= 41) return '朋友';
  if (s >= 21) return '眼熟';
  if (s >= 10) return '冷淡';
  return '陌生人';
}

