import fs from 'node:fs';
import path from 'node:path';
import { NodeApiClient, unwrap, createTurnCollector, discoverDshLaunchToken } from '../src/dsh-client.js';

const ROOT = path.resolve(process.cwd());
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const baseUrl = process.env.DSH_WEB_URL || cfg.dsh?.baseUrl || 'http://127.0.0.1:3080';
const api = new NodeApiClient(baseUrl, undefined, {
  token: discoverDshLaunchToken(),
  header: cfg.dsh?.authHeader,
  prefix: cfg.dsh?.authPrefix,
  allowRemote: cfg.dsh?.allowRemote === true,
});

const ONLY = process.env.ONLY || '';
const seenEvents = [];
const collectors = new Map();
const waiters = new Map();
let muxStarted = false;

function startEvents() {
  if (muxStarted) return;
  muxStarted = true;
  (async () => {
    try {
      const stream = api.events.mux({});
      for await (const envelope of stream) {
        const frame = envelope.payload;
        if (frame?.type !== 'session/event') continue;
        const sid = frame.sessionId;
        if ((/error|fail/i.test(frame.event.type) || frame.event.type === 'turn/end')) {
          seenEvents.push({ sessionId: sid, type: frame.event.type, data: frame.event.data ?? null, reason: frame.event.reason ?? null });
        }
        if (!waiters.has(sid) && !collectors.has(sid)) continue;
        let collector = collectors.get(sid) ?? null;
        if (!collector && frame.event.type === 'turn/start') {
          collector = createTurnCollector({ tolerantStart: true });
          collectors.set(sid, collector);
        }
        if (!collector && waiters.has(sid) && (frame.event.type === 'assistant/message' || frame.event.type === 'turn/end')) {
          collector = createTurnCollector({ tolerantStart: true });
          collectors.set(sid, collector);
        }
        const ended = collector ? collector.push(frame.event) : null;
        if (ended) {
          collectors.delete(sid);
          const arr = waiters.get(sid) ?? [];
          const waiter = arr.shift();
          if (!arr.length) waiters.delete(sid);
          if (waiter) {
            clearTimeout(waiter.timer);
            if (ended.reason?.kind === 'completed' && String(ended.text || '').trim()) waiter.resolve(ended.text.trim());
            else waiter.reject(new Error('turn not completed: ' + JSON.stringify({ kind: ended.reason?.kind, failure: ended.reason?.failure, error: ended.error })));
          }
        }
      }
    } catch {}
  })();
}

function waitTurn(sessionId, timeoutMs = 120000) {
  let settled = false;
  let timer = null;
  let waiter = null;
  const remove = () => {
    const arr = waiters.get(sessionId) ?? [];
    const idx = arr.indexOf(waiter);
    if (idx >= 0) arr.splice(idx, 1);
    if (!arr.length) waiters.delete(sessionId);
  };
  const promise = new Promise((resolve, reject) => {
    waiter = {
      timer: null,
      resolve: (text) => { if (settled) return; settled = true; clearTimeout(timer); remove(); resolve(text); },
      reject: (error) => { if (settled) return; settled = true; clearTimeout(timer); remove(); reject(error); },
    };
    timer = setTimeout(() => { if (settled) return; settled = true; remove(); reject(new Error('timeout')); }, timeoutMs);
    waiter.timer = timer;
    const arr = waiters.get(sessionId) ?? [];
    arr.push(waiter);
    waiters.set(sessionId, arr);
  });
  promise.cancel = () => { if (settled) return; settled = true; clearTimeout(timer); remove(); };
  return promise;
}

async function runPrompt(provider, model, text, workspaceDir) {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const wsValue = unwrap(await api.workspace.create({ path: workspaceDir }), 'workspace.create');
  const value = unwrap(await api.sessions.create({ workspaceId: wsValue.workspace.workspaceId }), 'session.create');
  const sessionId = value.sessionId;
  api.events.follow(sessionId);
  try {
    await api.sessions.selectModel({ sessionId, provider, model });
  } catch (e) {
    return { ok: false, error: 'selectModel: ' + (e?.message ?? e) };
  }
  const turn = waitTurn(sessionId);
  turn.catch(() => {});
  const started = Date.now();
  let accepted;
  try {
    accepted = await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text }] });
  } catch (e) {
    turn.cancel();
    return { ok: false, error: 'prompt: ' + (e?.message ?? e) };
  }
  if (!accepted?.result?.ok) {
    turn.cancel();
    return { ok: false, error: 'prompt rejected: ' + (accepted?.result?.error?.code ?? '') + ' ' + (accepted?.result?.error?.message ?? '') };
  }
  try {
    const output = await turn;
    return { ok: true, ms: Date.now() - started, text: output.slice(0, 600) };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

startEvents();

const promptText = '用两句话解释：为什么晚睡会影响第二天的状态。不要列点、不要讲道理。';

const results = {};
if (!ONLY || ONLY === 'deepseek-flash') results['deepseek-flash'] = await runPrompt('deepseek-account', 'deepseek-flash', promptText, path.join(ROOT, 'state', 'compare', 'a-flash'));
const freeModel = process.env.FREE_MODEL || 'deepseek-v4.1-flash-free';
if (!ONLY || ONLY === 'free') results[freeModel] = await runPrompt('our-free-model', freeModel, promptText, path.join(ROOT, 'state', 'compare', 'b-free'));

console.log(JSON.stringify({
  prompt: promptText,
  results,
  events: seenEvents.slice(-40),
}, null, 2));
process.exit(0);
