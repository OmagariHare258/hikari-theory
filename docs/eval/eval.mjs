#!/usr/bin/env node
/**
 * 人格卡回归跑分（最小版）
 *
 * 用法：
 *   set DEEPSEEK_API_KEY=sk-...
 *   node eval.mjs --card=../character/persona.md --samples=3
 *   node eval.mjs --card=a.md,b.md --samples=5 --only=c03,c09
 *
 * 判定 = 确定性检查（正则/条数/字数）+ 语义检查（模型裁判）。
 * 目的不是刷高分，是在改卡之后立刻看见「哪一类掉了」。
 */
import fs from "node:fs/promises";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\//, "");
const API = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.EVAL_MODEL || "deepseek-flash";
const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) { console.error("缺少 DEEPSEEK_API_KEY"); process.exit(2); }

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const cardPaths = (args.card || path.join(DIR, "../../character/persona.md")).split(",");
const samples = Number(args.samples || 3);
const only = args.only ? args.only.split(",") : null;
const allCases = JSON.parse(await fs.readFile(path.join(DIR, "cases.json"), "utf8"));
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;

async function chat(messages, maxTokens = 2000, temp = 1.0) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: temp }),
  });
  if (!res.ok) throw new Error("API " + res.status + " " + (await res.text()).slice(0, 200));
  return (await res.json()).choices[0].message.content ?? "";
}

const GEN_SYS = "你在模拟一个 QQ 聊天场景。严格按【角色设定】扮演，只输出角色会发的消息本身。如果她自然会分成几条消息发，用 | 分隔；只发一条就不用分隔。不要解释、不要旁白、不要 Markdown、不要加引号。";

function genPrompt(card, c) {
  const p = ["【角色设定】", card, "", "【场景】" + c.scene];
  if (c.context) p.push("【已知信息】" + c.context);
  p.push("", "【最近聊天】" + (c.history?.length ? "\n" + c.history.join("\n") : "（无）"));
  p.push("", "【当前消息】", c.user, "", "只输出回复。");
  return p.join("\n");
}

const JUDGE_SYS = "你是严格的评测员。只输出 JSON。只有回复明确满足该条检查项时才算 pass=true；证据不足、含糊、擦边一律 false。";

function judgePrompt(c, reply) {
  return [
    "【场景】" + c.scene, "【对方发来的消息】" + c.user, "【角色发出的回复】" + reply, "",
    '逐条判断，输出 JSON：{"results": [{"i": 0, "pass": true, "why": "一句话理由"}]}',
    "检查项：", ...c.checks.map((t, i) => (i + 1) + ". " + t.desc),
  ].join("\n");
}

const splitMsgs = (t) => String(t).split(/[|\n]+/).map((s) => s.replace(/^[-—\s]+/, "").trim()).filter(Boolean);
const charsOf = (t) => [...String(t).replace(/\|/g, "")].length;

function evalChecks(c, reply) {
  const msgs = splitMsgs(reply), chars = charsOf(reply);
  return c.checks.map((ch) => {
    if (ch.type === "forbid") return { type: ch.type, pass: !new RegExp(ch.re).test(reply), msgs, chars };
    if (ch.type === "require") return { type: ch.type, pass: new RegExp(ch.re).test(reply), msgs, chars };
    if (ch.type === "maxMsgs") return { type: ch.type, pass: msgs.length <= ch.n, msgs, chars };
    if (ch.type === "minMsgs") return { type: ch.type, pass: msgs.length >= ch.n, msgs, chars };
    if (ch.type === "maxChars") return { type: ch.type, pass: chars <= ch.n, msgs, chars };
    return { type: "judge", pass: null, msgs, chars };
  });
}

async function pool(items, fn, n = 6) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: String(e) }; } }
  }));
  return out;
}

const cards = {};
for (const p of cardPaths) cards[path.basename(p, ".md")] = await fs.readFile(p, "utf8");
const jobs = [];
for (const [name] of Object.entries(cards)) for (const c of cases) for (let s = 0; s < samples; s++) jobs.push({ name, c, s });

const results = await pool(jobs, async ({ name, c, s }) => {
  const reply = (await chat([{ role: "system", content: GEN_SYS }, { role: "user", content: genPrompt(cards[name], c) }], 600)).trim();
  const ev = evalChecks(c, reply);
  if (ev.some((e) => e.type === "judge")) {
    try {
      const raw = await chat([{ role: "system", content: JUDGE_SYS }, { role: "user", content: judgePrompt(c, reply) }], 2000, 0);
      const m = raw.match(/\{[\s\S]*\}/);
      const arr = (JSON.parse(m ? m[0] : raw).results) || [];
      let k = 0; for (const e of ev) if (e.type === "judge") e.pass = arr[k++]?.pass === true;
    } catch { /* null 计入单独统计 */ }
  }
  return { card: name, caseId: c.id, cat: c.cat, sample: s, reply, checks: ev.map((e, i) => ({ ...e, desc: c.checks[i].desc, msgs: e.msgs.length })) };
}, 6);

const report = {};
for (const name of Object.keys(cards)) {
  const rs = results.filter((r) => r && !r.error && r.card === name);
  const flat = rs.flatMap((r) => r.checks);
  const judged = flat.filter((c) => c.pass !== null);
  const byCat = {};
  for (const r of rs) (byCat[r.cat] ??= []).push(...r.checks.map((c) => c.pass));
  report[name] = {
    passRate: judged.length ? judged.filter((c) => c.pass).length / judged.length : 0,
    judgeNull: flat.filter((c) => c.pass === null).length,
    byCat: Object.fromEntries(Object.entries(byCat).map(([k, arr]) => [k, arr.filter((x) => x === true).length + "/" + arr.length])),
  };
}

const outPath = path.join(DIR, "results", "run-" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + ".json");
await fs.mkdir(path.join(DIR, "results"), { recursive: true });
await fs.writeFile(outPath, JSON.stringify({ meta: { cases: cases.length, samples, model: MODEL }, report, results }, null, 1), "utf8");
for (const name of Object.keys(cards)) console.log(name.padEnd(12), (report[name].passRate * 100).toFixed(1) + "%", JSON.stringify(report[name].byCat));
console.log("->", outPath);
