#!/usr/bin/env node
/**
 * 自动扫描小光发出的每条消息（AIGC 痕迹监控）
 *
 * 数据源：surfcore state/tool-calls.jsonl —— 每次 qq_send_* / qq_reply 调用都带正文。
 * 增量：记住上次读到的字节位置，只扫新增，可反复跑。
 *
 * 用法：
 *   node aigc-watch.mjs                 # 增量扫（适合挂定时任务）
 *   node aigc-watch.mjs --last=500      # 回扫最近 500 条调用
 *   node aigc-watch.mjs --log=... --state=...
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const LOG = args.log || path.join(os.homedir(), "surfcore", "state", "tool-calls.jsonl");
const STATE = args.state || path.join(path.dirname(LOG), "aigc-watch-state.json");
const OUT = args.out || path.join(path.dirname(LOG), "aigc-hits.jsonl");

const PATTERNS = [
  { id: "metaframe", sev: "P0", name: "「一句话」式元表述", re: /(一句话|简单说|简而言之|概括(一下|来说)?|长话短说|总结一下)[：:，,]?/g },
  { id: "antithesis", sev: "P0", name: "不是X，是Y", re: /不是[^，。！？]{1,15}[，,]?\s*(而是|是)/ },
  { id: "concession", sev: "P0", name: "虚假让步（有转折词）", re: /(确实|固然|可能是|算是|说实话|是挺|挺)[^。！？]{0,12}[。，,][^。！？]{0,25}(但|不过|可是|但是)[^。！？]{0,20}(也|都)/ },
  { id: "concede2", sev: "P0", name: "先扬后转（无连接词）", re: /是(挺|好|好看|厉害|不错|真的|强)[^，。！？]{0,6}[，,][^，。！？]{0,15}(还是|才|得|终究|到底)/ },
  { id: "metacrit", sev: "P1", name: "点评怎么评", re: /(含金量|历史地位|评判标准|怎么评|论实力|论荣誉|真正该看)/ },
  { id: "bothsides", sev: "P1", name: "两边都摆", re: /(都挺|都厉害|各有各|各有好处|看情况|因人而异)/ },
  { id: "summary", sev: "P0", name: "总结收尾", re: /(总之|说到底|归根结底|说白了|由此可见|总而言之|总的来说)/ },
  { id: "bigword", sev: "P1", name: "抽象大词", re: /(本质上|核心在于|底层逻辑|某种意义上|赋能|闭环|颗粒度)/ },
  { id: "listy", sev: "P1", name: "公式递进", re: /(首先|其次|再者|最后一点)/ },
];
const SEND_RE = /qq_send_message|qq_send_burst|qq_send_group_message|qq_send_private_message|qq_reply$/;

async function runOnce() {
const raw = await fs.readFile(LOG, "utf8");
let prev = { offset: 0, size: 0 };
if (!args.last) { try { prev = JSON.parse(await fs.readFile(STATE, "utf8")); } catch { /* 首次 */ } }
const buf = Buffer.from(raw, "utf8");
let start = 0;
if (args.last) {
  const lines = raw.split("\n");
  start = Buffer.byteLength(lines.slice(0, Math.max(0, lines.length - Number(args.last))).join("\n"), "utf8");
} else if (prev.size && buf.length >= prev.size && prev.offset <= buf.length) {
  start = prev.offset;
} // else: 文件被截断/重建 → 从头扫

const chunk = buf.subarray(Math.min(start, buf.length)).toString("utf8");
const calls = chunk.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.type === "call" && SEND_RE.test(r.tool || ""));

let scanned = 0, hits = 0;
const out = [];
for (const r of calls) {
  let a; try { a = JSON.parse(r.args); } catch { continue; }
  const texts = [];
  const add = (v) => { if (typeof v === "string" && v.trim()) texts.push(v.trim()); };
  if (Array.isArray(a.messages)) a.messages.forEach(add); else add(a.messages);
  add(a.text); add(a.message);
  for (const t of texts) {
    scanned++;
    const found = PATTERNS.filter((p) => p.re.test(t));
    if (!found.length) continue;
    hits++;
    out.push({ time: r.time, key: r.key, tool: r.tool.replace("mcp__snowluma__", ""), text: t, patterns: found.map((p) => p.sev + " " + p.name) });
  }
}

if (args.last) { /* 回扫不改状态 */ } else {
  await fs.writeFile(STATE, JSON.stringify({ offset: buf.length, size: buf.length, updated: new Date().toISOString() }), "utf8");
}
if (out.length && !args.last) {
  await fs.appendFile(OUT, out.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
}

console.log("扫描发送调用 " + calls.length + " 次 / 消息 " + scanned + " 条，命中 " + hits + " 条（" + (scanned ? ((hits / scanned) * 100).toFixed(1) : "0") + "%）");
for (const o of out.slice(0, 20)) {
  console.log("─".repeat(50));
  console.log("[" + o.patterns.join(" / ") + "] " + o.text.slice(0, 120));
}
}

if (args.watch) {
  const every = Number(args.watch) || 60;
  console.log("守护模式：每 " + every + " 秒扫一次（Ctrl+C 退出）");
  for (;;) { try { await runOnce(); } catch (e) { console.error("扫描失败:", String(e).slice(0, 120)); } await new Promise((r) => setTimeout(r, every * 1000)); }
} else { await runOnce(); }
