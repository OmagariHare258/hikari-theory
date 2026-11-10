// 「本群印象」：群聊里按人显示好感度（只列本群的人、≥10 分、降序、封顶）。
// 纯函数 + 临时文件，不联网。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { friendsInGroup, formatGroupImpressionsLine, affectionBand, IMPRESSION_MIN_SCORE } = await import('../src/affection-impressions.js');
const { loadAffection } = await import('../src/voice-affection.js');

const affection = {
  people: {
    '111': { name: '甲', score: 100, band: '最喜欢', groups: ['200000001'] },
    '222': { name: '乙', score: 59, band: '朋友', groups: ['200000001', '200000002'] },
    '333': { name: '丙', score: 12, band: '冷淡', groups: ['200000001'] },
    '444': { name: '丁', score: 9, band: '陌生人', groups: ['200000001'] },
    '555': { name: '戊', score: 80, band: '亲近', groups: ['200000002'] },
    '666': { name: '己', score: 70, band: '亲近' }, // 旧数据：没有 groups
    '777': { name: '庚', score: 30, band: '眼熟', groups: ['200000001', '200000002', '123456789'] },
  },
};

// ── ① 只列本群、按分数降序、<10 不列 ──────────────────────────────────────
const g900 = friendsInGroup(affection, '200000001');
assert.deepEqual(g900.map((x) => x.qq), ['111', '222', '777', '333'], '降序且不含 <10/其他群/无群关系');
assert.equal(g900[0].name, '甲');
assert.equal(g900[0].score, 100);
assert.equal(g900.every((x) => x.score >= IMPRESSION_MIN_SCORE), true);

// 群号可以是数字或字符串
assert.deepEqual(friendsInGroup(affection, 200000001).map((x) => x.qq), g900.map((x) => x.qq));

// 群 901：乙/戊/庚
assert.deepEqual(friendsInGroup(affection, '200000002').map((x) => x.qq), ['555', '222', '777']);

// 不存在的群 / 空群号：空数组
assert.deepEqual(friendsInGroup(affection, '999'), []);
assert.deepEqual(friendsInGroup(affection, ''), []);
assert.deepEqual(friendsInGroup({ people: {} }, '200000001'), []);

// 封顶
const many = { people: {} };
for (let i = 0; i < 30; i += 1) many.people[String(100 + i)] = { name: `人${i}`, score: 20 + i, band: '眼熟', groups: ['200000001'] };
assert.equal(friendsInGroup(many, '200000001').length, 12, '默认最多 12 个');
assert.equal(friendsInGroup(many, '200000001', { max: 3 }).length, 3);
assert.equal(friendsInGroup(many, '200000001', { minScore: 0 }).length, 12);

// ── ② 提示词那一行 ───────────────────────────────────────────────────────
const line = formatGroupImpressionsLine(affection, '200000001');
assert.match(line, /^【本群印象】/);
assert.match(line, /甲 100\/100（最喜欢）/);
assert.match(line, /没列到的人＝陌生人/);
assert.equal(formatGroupImpressionsLine(affection, '999'), '', '没有可列的人时不占 token');
assert.equal(formatGroupImpressionsLine(affection, ''), '');

// ── ③ 分档与脚本一致 ─────────────────────────────────────────────────────
assert.equal(affectionBand(100), '最喜欢');
assert.equal(affectionBand(81), '最喜欢');
assert.equal(affectionBand(80), '亲近');
assert.equal(affectionBand(61), '亲近');
assert.equal(affectionBand(60), '朋友');
assert.equal(affectionBand(41), '朋友');
assert.equal(affectionBand(40), '眼熟');
assert.equal(affectionBand(21), '眼熟');
assert.equal(affectionBand(20), '冷淡');
assert.equal(affectionBand(10), '冷淡');
assert.equal(affectionBand(9), '陌生人');
assert.equal(affectionBand(0), '陌生人');
assert.equal(affectionBand('x'), '陌生人');

// ── ④ loadAffection 保留 groups / lastSeen（旧文件没有也能读）──────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-affection-impressions-'));
const file = path.join(tmp, 'affection.json');
fs.writeFileSync(file, JSON.stringify({
  updatedAt: '2026-11-05 14:49:29',
  ownerFloor: 75,
  people: {
    '111': { name: '甲', score: 60, band: '朋友', lastSeen: '2026-11-05', groups: ['200000001', '200000002'] },
    '222': { name: '乙', score: 20, band: '冷淡', lastSeen: '2026-10-01' },
  },
}), 'utf8');
const loaded = loadAffection(file);
assert.deepEqual(loaded.people['111'].groups, ['200000001', '200000002']);
assert.equal(loaded.people['111'].lastSeen, '2026-11-05');
assert.deepEqual(loaded.people['222'].groups, [], '旧数据没有 groups 时为空数组');
assert.deepEqual(friendsInGroup(loaded, '200000001').map((x) => x.qq), ['111']);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log('OK test-affection-impressions');

