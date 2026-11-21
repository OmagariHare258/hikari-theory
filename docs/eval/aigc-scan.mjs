#!/usr/bin/env node
/**
 * 中文「AI 味」扫描器（聊天/短文本版）
 * 用法: node aigc-scan.mjs <file.txt>   或   echo "文本" | node aigc-scan.mjs -
 *       node aigc-scan.mjs --mode=deepseekese <file.txt>   # 只扫「鱼八股」
 *       node aigc-scan.mjs --mode=all <file.txt>           # 两套都扫
 *
 * 规则来源：zero-click/avoid-ai-writing-zh（42 类）+ shaswatco/anti-ai-writing-style +
 * AI 检测原理（困惑度/突发性）。适合扫 QQ/B站 短回复，不适合长篇论文。
 * deepseekese 组来自 B站《鱼八股？没人味？》（BV1yYsU63Ejh）总结的加重句/记账式口癖。
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

// 「鱼八股」：社区案例汇总（BV1yYsU63Ejh / BV1qbn16kEFh / BV1gMsM6TE9u + 热评）。
// 特征不是用词花，而是「给自己的话加重量 / 用模板代替反应」——真人聊天不这么端着。
const DEEPSEEKESE_PATTERNS = [
  { id: "ds-record", sev: "P0", name: "记账式收尾（我记下了/这笔账记着/稳稳接住）", re: /(这话我记下了|这笔账[^，。！？]{0,8}记着|小光记下了|等会儿回来收|可记着呢|稳稳接住)/g },
  { id: "ds-admit", sev: "P0", name: "加重式表态（这话我认/心里有数/说得不轻）", re: /(行，?这话我认|这事我心里有数|这话说得不轻)/g },
  { id: "ds-guard", sev: "P0", name: "装稳重腔（睡吧我守着/我听着你往下讲/我先不接）", re: /(睡吧[^。！？]{0,8}我守着|我听着[^。！？]{0,8}往下讲|这个问题[^。！？]{0,8}先不接)/g },
  { id: "ds-selfintro", sev: "P0", name: "报家门（本鱼是一条普通的…/本鱼最喜欢的一句话）", re: /(本鱼是(?:一条|一尾)[^。！？]{0,10}|本鱼最喜欢的一句话)/g },
  { id: "ds-praise", sev: "P1", name: "万能夸（节奏紧凑+干货满满+值得一看）", re: /(?:节奏紧凑|干货满满|值得一看)[^。！？]{0,40}(?:节奏紧凑|干货满满|值得一看)/g },
  { id: "ds-teacher", sev: "P0", name: "老师腔（怕你听不懂/慢慢跟你讲/应该是这样的）", re: /(怕你听不懂|慢慢(?:跟你|和你)?讲|应该是这样的)/g },
  { id: "ds-hedge2", sev: "P1", name: "模棱两可腔（绝大多数情况下/说不太准）", re: /(绝大多数情况下|我也?说不太准)/g },
  { id: "ds-laugh", sev: "P2", name: "笑死式万能反应", re: /笑死/g },
  { id: "ds-namejoke", sev: "P1", name: "把名字塞进梗（是想笑死小光吗）", re: /是想笑死.{0,4}吗/g },
  { id: "ds-selfintro-xg", sev: "P0", name: "小光报家门（只是普通学生/作为CCC/本光）", re: /小光(?:只是|就是)[^。！？]{0,12}?(?:学生|乘务员|列车长|列车员)|小光(?:是|就是)(?:一个|个|一名)?(?:普通|普通小)?(?:学生|乘务员|列车长|列车员)|作为\s*(?:一列|列车|CCC|海兰德)|本光/g },
  { id: "ds-trainstack", sev: "P1", name: "列车词堆叠（同句≥3个）", re: /(?:列车|站台|检票|发车|乘务员|车厢|轨道|晚点|脱轨)[^。！？]{0,25}(?:列车|站台|检票|发车|乘务员|车厢|轨道|晚点|脱轨)[^。！？]{0,25}(?:列车|站台|检票|发车|乘务员|车厢|轨道|晚点|脱轨)/g },
  { id: "ds-techtranslate", sev: "P0", name: "技术翻译成列车（服务器=站台/代码=轨道）", re: /(?:服务器|代码|报错|接口|部署|带宽|内存|配置|数据库|程序)[^。！？]{0,30}(?:站台|列车|轨道|检票|车厢|发车|乘务员|晚点|脱轨)|(?:站台|列车|轨道|检票|车厢|发车|乘务员)[^。！？]{0,30}(?:服务器|代码|报错|接口|部署|带宽|内存|配置|数据库|程序)/g },
  { id: "ds-trainstack2", sev: "P1", name: "列车词堆叠+正事（技术话题≥2）", re: /(?:服务器|代码|报错|接口|部署|带宽|内存|配置|数据库|程序|论文|作业)[^。！？]{0,40}(?:列车|站台|检票|发车|乘务员|车厢|轨道|晚点|脱轨)[^。！？]{0,40}(?:列车|站台|检票|发车|乘务员|车厢|轨道|晚点|脱轨)|(?:列车|站台|检票|发车|乘务员|车厢|轨道|晚点|脱轨)[^。！？]{0,40}(?:列车|站台|检票|发车|乘务员|车厢|轨道|晚点|脱轨)[^。！？]{0,40}(?:服务器|代码|报错|接口|部署|带宽|内存|配置|数据库|程序|论文|作业)/g },
];

const cliArgs = process.argv.slice(2);
const modeArg = (cliArgs.find((a) => a.startsWith("--mode=")) || "").split("=")[1] || "default";
const selectedPatterns = modeArg === "deepseekese"
  ? DEEPSEEKESE_PATTERNS
  : modeArg === "all"
    ? [...PATTERNS, ...DEEPSEEKESE_PATTERNS]
    : PATTERNS;

const src = cliArgs.find((a) => !a.startsWith("--")) || "-";
const text = src === "-" ? await new Promise((r) => { let d = ""; process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => r(d)); }) : await fs.readFile(src, "utf8");
const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
let total = 0;
const tally = {};
for (const line of lines) {
  const hits = [];
  for (const p of selectedPatterns) {
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
