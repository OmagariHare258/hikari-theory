// B站定时分享提示词：二代仿真必须带会话 key/token（2026-11-05 修），否则工具全 403。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSharePrompt } from '../src/bili-share-scheduler.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const card = { title: '测试视频', url: 'https://www.bilibili.com/video/BV1xx411c7mD', reason: '看了个视频' };

// ① reserved2：带 key/token
const reserved = buildSharePrompt(card, '16:30', {
  mode: 'reserved2', sessionKey: 'group:200000001', token: 'tok-abc123',
});
assert.match(reserved, /key=group:200000001/, '带会话 key');
assert.match(reserved, /tok-abc123/, '带会话令牌');
assert.match(reserved, /mcp__snowluma__qq_send_message/, '告诉模型用发送工具');
assert.match(reserved, /不要写进消息、不要外传/, 'token 不能外泄');

// ② reserved2 + 主人私聊
const privatePrompt = buildSharePrompt(card, '16:30', {
  mode: 'reserved2', privateTarget: true, sessionKey: 'private:10000001', token: 'tok-xyz',
});
assert.match(privatePrompt, /私聊/);
assert.match(privatePrompt, /key=private:10000001/);
assert.match(privatePrompt, /tok-xyz/);

// ③ chat 模式不加 token 行（自动发送，不需要工具）
const chat = buildSharePrompt(card, '16:30', { mode: 'chat' });
assert.ok(!chat.includes('会话令牌'), 'chat 模式不需要令牌');
assert.match(chat, /只输出要发到群里的内容/);

// ④ 接线：桥接传 getSessionToken；scheduler 接受完整 key
const schedulerSrc = fs.readFileSync(path.join(root, 'src/bili-share-scheduler.js'), 'utf8');
assert.match(schedulerSrc, /getSessionToken = \(\) => ''/, 'scheduler 有 getSessionToken 选项');
assert.match(schedulerSrc, /includes\(':'\) \? String\(target\) : `group:\$\{target\}`/, '完整 key 不再重复加 group:');
const bridgeSrc = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8');
assert.match(bridgeSrc, /getSessionToken: \(key\) => String\(getSocialV2State\(key\)\?\.agentToken/, '桥接提供会话令牌');

console.log('OK test-bili-share-prompt');

