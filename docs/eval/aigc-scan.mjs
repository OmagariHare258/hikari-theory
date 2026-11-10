#!/usr/bin/env node
/**
 * 中文「AI 味」扫描器（聊天/短文本版）
 * 用法: node aigc-scan.mjs <file.txt>   或   echo "文本" | node aigc-scan.mjs -
 *
 * 规则来源：zero-click/avoid-ai-writing-zh（42 类）+ shaswatco/anti-ai-writing-style +
 * AI 检测原理（困惑度/突发性）。适合扫 QQ/B站 短回复，不适合长篇论文。
 */
import fs from "node:fs/promises";

const PATTERNS = [
  { id: "metaframe", sev: "P0", name: "「一句话」式元表述", re: /(一句话|简单说|简而言之|概括(一下|来说)?|长话短说|总结一下)[：:，,]?/g },
  { id: "antithesis", sev: "P0", name: "不是X，是Y（否定-重构）", re: /不是[^，。！？]{1,15}[，,]?\s*(而是|是)/g },
  { id: "concession", sev: "P0", name: "虚假让步（先承认一半再补反面）", re: /(确实|固然|可能是|算是|说实话|是挺|挺)[^。！？]{0,12}[。，,][^。！？]{0,25}(但|不过|可是|但是)[^。！？]{0,20}(也|都)/g },
  { id: "concede2", sev: "P0", name: "先扬后转（无连接词）", re: /是(挺|好|好看|厉害|不错|真的|强)[^，。！？]{0,6}[，,][^，。！？]{0,15}(还是|才|得|终究|到底)/g },
  { id: "metacrit", sev: "P1", name: "点评「怎么评」（解说员口吻）", re: /(含金量|历史地位|评判标准|怎么评|论实力|论荣誉|真正该看)/g },
  { id: "bothsides", sev: "P0", name: "两边都摆、不下判断", re: /(都挺|都厉害|各有各|各有好处|看情况|因人而异|仁者见仁)/g },
  { id: "summary", sev: "P0", name: "总结收尾", re: /(总之|说到底|归根结底|说白了|由此可见|总而言之|总的来说)/g },
  { id: "bigword", sev: "P1", name: "抽象大词", re: /(本质上|核心在于|底层逻辑|某种意义上|从某种角度|赋予|赋能|闭环|颗粒度)/g },
  { id: "listy", sev: "P1", name: "公式化递进", re: /(首先|其次|再者|最后一点|第一[，,].{0,20}第二[，,])/g },
  { id: "triple", sev: "P1", name: "排比/三连", re: /([^，。！？]{2,8}[，,]){2}[^，。！？]{2,8}[。！？]/g },
  { id: "hedge", sev: "P1", name: "缓冲词堆积", re: /(其实|本质上|某种意义上|客观来说|不得不说|可以说)/g },
  { id: "force", sev: "P2", name: "强行升华", re: /(这就是|这才叫|这才是|值得深思|引人深省)/g },
];

const src = process.argv[2] || "-";
const text = src === "-" ? await new Promise((r) => { let d = ""; process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => r(d)); }) : await fs.readFile(src, "utf8");
const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
let total = 0;
const tally = {};
for (const line of lines) {
  const hits = [];
  for (const p of PATTERNS) {
    const m = line.match(p.re);
    if (m) { hits.push(p); total += m.length; tally[p.id] = (tally[p.id] || 0) + m.length; }
  }
  const dashes = (line.match(/——/g) || []).length;
  if (hits.length || dashes >= 2) {
    console.log("─".repeat(60));
    console.log(line);
    for (const h of hits) console.log("  ✗ [" + h.sev + "] " + h.name);
    if (dashes >= 2) console.log("  ✗ [P2] 破折号过密 ×" + dashes);
  }
}
if (!total) console.log("没有命中 AI 味模式。");
else { console.log("─".repeat(60)); console.log("命中汇总：", JSON.stringify(tally), "共", total, "处 /", lines.length, "行"); }
