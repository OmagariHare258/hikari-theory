#!/usr/bin/env node
/**
 * 候选 AI 特征体检：先看它在自家语料里到底出现几次，再决定要不要写进规则。
 *
 * 用法：
 *   node tell-check.mjs --re="一方面[sS]{0,30}另一方面" --re="值得注意"
 *   node tell-check.mjs --patterns=patterns.txt     # 每行 名称<TAB>正则
 *   node tell-check.mjs --re="..." --days=30
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const LOG = args.log || path.join(os.homedir(), "surfcore", "state", "tool-calls.jsonl");
const DAYS = Number(args.days || 30);
const SEND_RE = /qq_send_message|qq_send_burst|qq_send_group_message|qq_send_private_message|qq_reply$/;

let list = [];
if (args.patterns) {
  const txt = await fs.readFile(args.patterns, "utf8");
  list = txt.split("\n").filter(Boolean).map((l) => { const [name, re] = l.split("\t"); return [name || re, re || name]; });
} else {
  list = (args.re || "").split("|||").filter(Boolean).map((re) => [re, re]);
}
if (!list.length) { console.log("用法: --re=\"正则\" 可重复（用 ||| 分隔）"); process.exit(1); }

const cutoff = Date.now() - DAYS * 86400_000;
const raw = await fs.readFile(LOG, "utf8");
const texts = [];
for (const line of raw.split("\n").filter(Boolean)) {
  let r; try { r = JSON.parse(line); } catch { continue; }
  if (r.type !== "call" || !SEND_RE.test(r.tool || "") || Date.parse(r.time) < cutoff) continue;
  let a; try { a = JSON.parse(r.args); } catch { continue; }
  let m = a.messages;
  if (typeof m === "string" && m.trim().startsWith("[")) { try { m = JSON.parse(m); } catch {} }
  if (Array.isArray(m)) texts.push(...m.map(String)); else if (m) texts.push(String(m));
  if (a.text) texts.push(String(a.text));
}

console.log("语料：" + texts.length + " 条（最近 " + DAYS + " 天）");
for (const [name, reSrc] of list) {
  let re; try { re = new RegExp(reSrc); } catch { console.log("  ✗ 正则错误：" + reSrc); continue; }
  const hits = texts.filter((t) => re.test(t));
  const verdict = hits.length >= 3 ? "可考虑加入" : hits.length === 0 ? "不加入（0 命中）" : "观察（样本不足）";
  console.log("  " + verdict.padEnd(14) + " " + name + "：" + hits.length + " 次" + (hits.length ? "  例：「" + hits[0].slice(0, 40) + "」" : ""));
}
