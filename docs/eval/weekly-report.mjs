#!/usr/bin/env node
/**
 * 周报统计（调优模组的输入端）
 *
 * 从 surfcore/state/tool-calls.jsonl 取最近 7 天的发送记录，算：
 *   消息量 / 每调用条数 / 平均字数 / AI 句式命中率 / 口癖频率 / 高频开头
 * 输出 Markdown 到 stdout，同时把摘要追加到 state/weekly-stats.jsonl（便于下周对比）。
 *
 * 用法：node weekly-report.mjs [--days=7] [--log=...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const DAYS = Number(args.days || 7);
const LOG = args.log || path.join(os.homedir(), "surfcore", "state", "tool-calls.jsonl");
const STATE_DIR = path.dirname(LOG);
const SEND_RE = /qq_send_message|qq_send_burst|qq_send_group_message|qq_send_private_message|qq_reply$/;

const PATTERNS = [
  ["metaframe", "「一句话」式元表述", /(一句话|简单说|简而言之|概括(一下|来说)?|长话短说|总结一下)[：:，,]?/],
  ["antithesis", "不是X，是Y", /不是[^，。！？]{1,15}[，,]?\s*(而是|是)/],
  ["concession", "虚假让步", /(确实|固然|可能是|算是|说实话|是挺|挺)[^。！？]{0,12}[。，,][^。！？]{0,25}(但|不过|可是|但是)[^。！？]{0,20}(也|都)/],
  ["concede2", "先扬后转", /是(挺|好|好看|厉害|不错|真的|强)[^，。！？]{0,6}[，,][^，。！？]{0,15}(还是|才|得|终究|到底)/],
  ["metacrit", "点评怎么评", /(含金量|历史地位|评判标准|怎么评|论实力|论荣誉|真正该看)/],
  ["bothsides", "两边都摆", /(都挺|都厉害|各有各|各有好处|看情况|因人而异)/],
  ["summary", "总结收尾", /(总之|说到底|归根结底|说白了|由此可见|总而言之|总的来说)/],
  ["bigword", "抽象大词", /(本质上|核心在于|底层逻辑|某种意义上|赋能|闭环|颗粒度)/],
  ["listy", "公式递进", /(首先|其次|再者|最后一点)/],
];
const ECHO = /^[^，。！？|\n]{0,6}[啊呢嘛]?——[？?]/;

const cutoff = Date.now() - DAYS * 86400_000;
const raw = await fs.readFile(LOG, "utf8");
const calls = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.type === "call" && SEND_RE.test(r.tool || "") && Date.parse(r.time) >= cutoff);

let msgs = 0, chars = 0, dashes = 0, questions = 0, echo = 0;
const hits = {}; for (const [id] of PATTERNS) hits[id] = 0;
const starts = new Map();
const perKey = {};
for (const r of calls) {
  let a; try { a = JSON.parse(r.args); } catch { continue; }
  const texts = [];
  let m = a.messages;
  if (typeof m === "string" && m.trim().startsWith("[")) { try { m = JSON.parse(m); } catch {} }
  if (Array.isArray(m)) texts.push(...m); else if (m) texts.push(m);
  if (a.text) texts.push(a.text); if (a.message) texts.push(a.message);
  perKey[r.key] = (perKey[r.key] || 0) + texts.length;
  for (const t0 of texts) {
    const t = String(t0).trim(); if (!t) continue;
    msgs++; chars += [...t].length;
    dashes += (t.match(/——/g) || []).length;
    questions += (t.match(/[？?]/g) || []).length;
    if (ECHO.test(t)) echo++;
    for (const [id, , re] of PATTERNS) if (re.test(t)) hits[id]++;
    const head = t.replace(/^[…\s"\[]+/, "").replace(/[，。！？~—].*$/, "").slice(0, 4);
    if (head.length >= 2 && /[\u4e00-\u9fffA-Za-z]/.test(head[0])) starts.set(head, (starts.get(head) || 0) + 1);
  }
}
const pct = (n) => msgs ? ((n / msgs) * 100).toFixed(1) + "%" : "0%";
const aiTotal = Object.values(hits).reduce((a, b) => a + b, 0);
const topStarts = [...starts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).filter(([, n]) => n >= 3);

const out = [];
out.push("# 周报 · " + new Date().toISOString().slice(0, 10));
out.push("");
out.push("周期：" + DAYS + " 天；发送调用 " + calls.length + " 次，消息 " + msgs + " 条");
out.push("");
out.push("## 基本盘");
out.push("");
out.push("| 指标 | 数值 |");
out.push("| --- | ---: |");
out.push("| 每条调用平均消息数 | " + (calls.length ? (msgs / calls.length).toFixed(1) : "0") + " |");
out.push("| 平均每条字数 | " + (msgs ? (chars / msgs).toFixed(1) : "0") + " |");
out.push("| 破折号 / 条 | " + (msgs ? (dashes / msgs).toFixed(2) : "0") + " |");
out.push("| 问号 / 条 | " + (msgs ? (questions / msgs).toFixed(2) : "0") + " |");
out.push("| 复读词+——？开头 | " + pct(echo) + " |");
out.push("");
out.push("## AI 句式命中（" + aiTotal + " 处，占消息 " + pct(aiTotal) + "）");
out.push("");
for (const [id, name] of PATTERNS) out.push("- " + name + "：" + hits[id] + "（" + pct(hits[id]) + "）");
out.push("");
out.push("## 高频开头（疑似口癖，≥3 次）");
out.push("");
out.push(topStarts.length ? topStarts.map(([k, n]) => "- 「" + k + "…」×" + n).join("\n") : "- 无");
out.push("");
out.push("## 会话分布");
out.push("");
const keys = Object.entries(perKey).sort((a, b) => b[1] - a[1]).slice(0, 10);
out.push(keys.length ? keys.map(([k, n]) => "- " + k + "：" + n + " 条").join("\n") : "- 无");
const md = out.join("\n");
console.log(md);

const summary = { time: new Date().toISOString(), days: DAYS, calls: calls.length, msgs, aiHits: aiTotal, aiRate: msgs ? +(aiTotal / msgs).toFixed(3) : 0, echoRate: msgs ? +(echo / msgs).toFixed(3) : 0, dashPerMsg: msgs ? +(dashes / msgs).toFixed(2) : 0 };
try {
  await fs.mkdir(path.join(STATE_DIR, "weekly-reports"), { recursive: true });
  await fs.writeFile(path.join(STATE_DIR, "weekly-reports", "weekly-" + new Date().toISOString().slice(0, 10) + ".md"), md, "utf8");
  await fs.appendFile(path.join(STATE_DIR, "weekly-stats.jsonl"), JSON.stringify(summary) + "\n", "utf8");
} catch {}
