// 跨会话事务台（方案 B）：配置归一、发起人档位限次、范围校验、peek 裁剪、提示词/审计格式 + 接线契约。
// 纯函数 + 静态检查，不联网、不启动桥接。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const {
  DEFAULT_CROSS_TASK, buildPeekSlice, crossSendPolicyError, crossTaskAuditLine,
  crossTaskDailyLimit, formatCrossTaskPrompt, normalizeCrossTaskConfig, validateCrossTaskRequest,
} = await import('../src/cross-task.js');

const ownerQQ = '10000001';
const gate = normalizeCrossTaskConfig({});
const allowedKeys = new Set(['group:200000001', 'group:200000002', 'private:10000001', 'private:10000002']);
const baseAllowed = (k, kind, id) => allowedKeys.has(`${kind}:${id}`);
const owner = { personId: ownerQQ, isOwner: true, isWhitelisted: true, affection: 100, name: '主人' };
const whitelisted = { personId: '111', isOwner: false, isWhitelisted: true, affection: 20, name: '白名单' };
const high = { personId: '222', isOwner: false, isWhitelisted: false, affection: 60, name: '高好感' };
const low = { personId: '333', isOwner: false, isWhitelisted: false, affection: 30, name: '普通' };

// ── ① 配置默认值 ───────────────────────────────────────────────────────────
assert.equal(DEFAULT_CROSS_TASK.ownerOnly, false, '默认非主人也能发起');
assert.equal(DEFAULT_CROSS_TASK.allowPrivateToGroup, true, '私聊→群默认由小光自审');
assert.equal(DEFAULT_CROSS_TASK.allowGroupToPrivate, true);
assert.equal(DEFAULT_CROSS_TASK.highAffectionDaily, 5);
assert.equal(DEFAULT_CROSS_TASK.defaultDaily, 3);
const d = normalizeCrossTaskConfig(undefined);
assert.equal(d.ownerOnly, false);
assert.equal(d.highAffectionAt, 60);
assert.equal(normalizeCrossTaskConfig({ ownerOnly: true }).ownerOnly, true);
assert.equal(normalizeCrossTaskConfig({ ttlMs: 1 }).ttlMs, 60_000);
assert.equal(normalizeCrossTaskConfig({ maxTasksPerDay: 9e9 }).maxTasksPerDay, 2000);

// ── ② 发起人档位 ───────────────────────────────────────────────────────────
assert.equal(crossTaskDailyLimit({ requester: owner, gate }), 0, '主人不限次');
assert.equal(crossTaskDailyLimit({ requester: whitelisted, gate }), 0, '白名单不限次');
assert.equal(crossTaskDailyLimit({ requester: high, gate }), 5, '好感 ≥60 每天 5 次');
assert.equal(crossTaskDailyLimit({ requester: { ...high, affection: 59 }, gate }), 3, '好感 <60 每天 3 次');
assert.equal(crossTaskDailyLimit({ requester: low, gate }), 3);
assert.equal(crossTaskDailyLimit({ requester: whitelisted, gate: { ...gate, trustedWhitelistUnlimited: false } }), 3, '关掉白名单不限次后按好感档');
assert.equal(crossTaskDailyLimit({ requester: high, gate: { ...gate, highAffectionAt: 70 } }), 3);

// ── ③ 请求校验 ─────────────────────────────────────────────────────────────
const okReq = validateCrossTaskRequest({
  requesterKey: 'private:10000001', task: '把群里刚才聊的整理给我', readKeys: ['group:200000001'],
  sendTargets: ['private:10000001'], requester: owner, allowed: baseAllowed,
  dailyCount: 999, totalDailyCount: 0, activeForSource: 0, ownerQQ, gate,
});
assert.equal(okReq.ok, true, JSON.stringify(okReq));

// 群会话也能发起（非主人）
const groupReq = validateCrossTaskRequest({
  requesterKey: 'group:200000001', task: '整理一下', readKeys: ['group:200000001'],
  sendTargets: ['private:10000001'], requester: high, allowed: baseAllowed,
  dailyCount: 0, totalDailyCount: 0, activeForSource: 0, ownerQQ, gate,
});
assert.equal(groupReq.ok, true, JSON.stringify(groupReq));
assert.equal(groupReq.dailyLimit, 5);

// ownerOnly=true 时才限主人
assert.match(validateCrossTaskRequest({
  requesterKey: 'group:200000001', task: 'x', readKeys: ['group:200000001'], sendTargets: ['private:10000001'],
  requester: high, allowed: baseAllowed, dailyCount: 0, totalDailyCount: 0, activeForSource: 0, ownerQQ,
  gate: { ...gate, ownerOnly: true },
}).error, /只允许主人/);

// 次数：好感 ≥60 第 5 次后拒绝；<60 第 3 次后拒绝
assert.match(validateCrossTaskRequest({ requesterKey: 'group:200000001', task: 'x', readKeys: ['group:200000001'], sendTargets: ['private:10000001'], requester: high, allowed: baseAllowed, dailyCount: 5, totalDailyCount: 0, activeForSource: 0, ownerQQ, gate }).error, /每天最多 5/);
assert.match(validateCrossTaskRequest({ requesterKey: 'group:200000001', task: 'x', readKeys: ['group:200000001'], sendTargets: ['private:10000001'], requester: low, allowed: baseAllowed, dailyCount: 3, totalDailyCount: 0, activeForSource: 0, ownerQQ, gate }).error, /每天最多 3/);
// 主人/白名单不受个人次数限制（但受全局上限）
assert.equal(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: 'x', readKeys: ['group:200000001'], sendTargets: ['private:10000001'], requester: owner, allowed: baseAllowed, dailyCount: 999, totalDailyCount: 0, activeForSource: 0, ownerQQ, gate }).ok, true);
assert.match(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: 'x', readKeys: ['group:200000001'], sendTargets: ['private:10000001'], requester: owner, allowed: baseAllowed, dailyCount: 0, totalDailyCount: 200, activeForSource: 0, ownerQQ, gate }).error, /全局/);

// 空任务/空读/空发/越界
assert.match(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: '  ', readKeys: ['group:200000001'], sendTargets: ['private:10000001'], requester: owner, allowed: baseAllowed, ownerQQ, gate }).error, /任务描述/);
assert.match(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: 'x', readKeys: [], sendTargets: ['private:10000001'], requester: owner, allowed: baseAllowed, ownerQQ, gate }).error, /要读/);
assert.match(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: 'x', readKeys: ['group:200000001'], sendTargets: [], requester: owner, allowed: baseAllowed, ownerQQ, gate }).error, /发送目标/);
assert.match(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: 'x', readKeys: ['group:999999'], sendTargets: ['private:10000001'], requester: owner, allowed: baseAllowed, ownerQQ, gate }).error, /不能读取/);
assert.match(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: 'x', readKeys: ['group:200000001'], sendTargets: ['group:999999'], requester: owner, allowed: baseAllowed, ownerQQ, gate }).error, /不能发送/);
assert.match(validateCrossTaskRequest({ requesterKey: 'private:10000001', task: 'x', readKeys: ['group:200000001'], sendTargets: ['private:10000001'], requester: owner, allowed: baseAllowed, activeForSource: 1, ownerQQ, gate }).error, /已经有一个/);

// ── ④ 内容边界：默认放开，交给小光自审；显式关掉才硬拦 ─────────────────────
assert.equal(crossSendPolicyError({ readKeys: ['private:10000001'], targetKey: 'group:200000001', gate }), '');
assert.equal(crossSendPolicyError({ readKeys: ['group:200000001'], targetKey: 'private:10000002', gate }), '');
assert.match(crossSendPolicyError({ readKeys: ['private:10000001'], targetKey: 'group:200000001', gate: { ...gate, allowPrivateToGroup: false } }), /私聊→群/);
assert.match(crossSendPolicyError({ readKeys: ['group:200000001'], targetKey: 'private:10000002', gate: { ...gate, allowGroupToPrivate: false } }), /群→私聊/);

// ── ⑤ peek 裁剪 ────────────────────────────────────────────────────────────
const long = Array.from({ length: 10 }, (_, i) => ({ text: `第${i}条`, isSelf: false, sender: '甲', messageId: String(i), time: 1000 + i }));
const slice = buildPeekSlice(long, { limit: 3, maxChars: 4000 });
assert.equal(slice.length, 3);
assert.equal(slice[2].text, '第9条');
assert.equal(slice[0].text, '第7条');
assert.equal(buildPeekSlice([{ text: '' }, { text: ' ' }], {}).length, 0);
assert.ok(buildPeekSlice(Array.from({ length: 5 }, () => ({ text: 'x'.repeat(100) })), { limit: 5, maxChars: 250 }).length <= 2);

// ── ⑥ 提示词 / 审计格式 ────────────────────────────────────────────────────
const prompt = formatCrossTaskPrompt({
  persona: '你是小光。', task: '把群里聊的整理给我', reads: ['group:200000001'], sends: ['private:10000001'],
  token: 'tok-123', taskKey: 'cross:abcd', limits: gate, names: { 'group:200000001': '测试群' },
  requester: high,
});
assert.match(prompt, /【跨会话事务台】/);
assert.match(prompt, /测试群/);
assert.match(prompt, /tok-123/);
assert.match(prompt, /怎么判断该不该帮/);
assert.match(prompt, /好感度 60/);
assert.match(prompt, /小光自己的口吻复述/, '允许用小光口吻复述');
assert.match(prompt, /谁说的、数字、时间、条件、约定/, '复述时关键信息不能改');
assert.match(prompt, /qq_peek_conversation/);
assert.match(prompt, /qq_cross_send/);
assert.match(prompt, /qq_cross_finish/);
const audit = JSON.parse(crossTaskAuditLine({ taskId: 't1', sourceKey: 'private:1', requester: high, task: 'x', reads: ['group:2'], sends: ['private:1'], sent: [{ targetKey: 'private:1', text: 'hi' }], summary: 'done' }));
assert.equal(audit.taskId, 't1');
assert.equal(audit.requester.isOwner, false);

// ── ⑦ 接线契约（静态）────────────────────────────────────────────────────
const bridgeSrc = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8');
assert.match(bridgeSrc, /'\/api\/socialV2\/cross-task'/);
assert.match(bridgeSrc, /'\/api\/socialV2\/cross-peek'/);
assert.match(bridgeSrc, /'\/api\/socialV2\/cross-send'/);
assert.match(bridgeSrc, /'\/api\/socialV2\/cross-finish'/);
assert.match(bridgeSrc, /async function createCrossSession/);
assert.match(bridgeSrc, /KNOWN_AGENT_TOKENS\.add\(crossToken\)/);
assert.match(bridgeSrc, /socialV2\.crossTask = normalizeCrossTaskConfig/);
assert.match(bridgeSrc, /crossPersonDaily\(personId\)/, '按人记的每日次数');
assert.match(bridgeSrc, /bumpCrossPersonDaily\(personId\)/, '成功后按人记账');
assert.match(bridgeSrc, /【跨会话】/, '唤醒提示会告诉它可以发起事务台');
assert.match(bridgeSrc, /voiceLastSpeaker\.get\(key\)\?\.userId/, '群聊取最后说话的人当请求人');

const mcpSrc = fs.readFileSync(path.join(root, 'src/mcp-snowluma-safe.js'), 'utf8');
for (const name of ['qq_cross_task', 'qq_peek_conversation', 'qq_cross_send', 'qq_cross_finish']) {
  assert.match(mcpSrc, new RegExp(`'${name}'`), `MCP 注册 ${name}`);
  assert.match(mcpSrc, new RegExp(`${name}: 'crossTask'`), `${name} 受 crossTask 开关控制`);
}
assert.match(mcpSrc, /好感度 ≥60 的人每天最多 5 次/, '工具描述写清发起人档位');

console.log('OK test-cross-task');

