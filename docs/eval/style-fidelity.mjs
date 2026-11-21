#!/usr/bin/env node
/**
 * 人味体检：把「小光」和「群友/私聊对象」的说话方式放在一起比。
 *
 * 数据源：surfcore/state/social-v2.json 的 recentMessages（每个会话最近 100 条）。
 * 只做只读统计，不改任何状态；输出 Markdown。
 *
 * 用法：
 *   node style-fidelity.mjs
 *   node style-fidelity.mjs --json
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const STATE = args.state || path.join(os.homedir(), 'surfcore', 'state', 'social-v2.json')

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
const PUNCT = /[，。！？、；：…—～~,.!?;:]/g
const QMARK = /[？?]/
const SELFREF = /小光/g

// 清掉非闲聊内容：引用前缀、@、长报告、星级表、链接、代码块、系统标签。
// 目的：只比「聊天怎么说」，不把评估报告/清单也算进说话风格。
function cleanText(t) {
  let s = String(t ?? '').trim()
  s = s.replace(/^\[引用[^\]]*\]/, '').replace(/^@\S+\s*/, '').trim()
  if (!s) return ''
  if ([...s].length > 100) return ''
  const stars = (s.match(/[★☆]/g) || []).length
  if (stars >= 2) return ''
  if (/https?:\/\//.test(s) || s.includes('```') || s.startsWith('【')) return ''
  if (/^\[(图片|表情|转发消息|卡片消息)/.test(s)) return ''
  if ((s.match(/\d/g) || []).length >= 4) return ''
  return s
}

function stats(texts) {
  const clean = texts.map((t) => String(t ?? '').trim()).filter(Boolean)
  if (!clean.length) {
    return { n: 0, avg: 0, median: 0, short: 0, tiny: 0, long: 0, punct: 0, q: 0, emoji: 0, self: 0, unique: 0, top2: [] }
  }
  const lens = clean.map((t) => [...t].length).sort((a, b) => a - b)
  const totalPunct = clean.reduce((n, t) => n + (t.match(PUNCT) || []).length, 0)
  const totalChars = lens.reduce((a, b) => a + b, 0)
  const bigrams = new Map()
  for (const t of clean) {
    const chars = [...t.replace(/\s+/g, '')]
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const g = chars[i] + chars[i + 1]
      if (!/[，。！？、；：…—～~,.!?;:\s]/.test(g)) bigrams.set(g, (bigrams.get(g) || 0) + 1)
    }
  }
  const top2 = [...bigrams.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const allChars = new Set(clean.join('').replace(/\s+/g, ''))
  return {
    n: clean.length,
    avg: +(totalChars / clean.length).toFixed(1),
    median: lens[Math.floor(lens.length / 2)],
    short: clean.filter((t) => [...t].length <= 10).length,
    tiny: clean.filter((t) => [...t].length <= 3 || /^[\s？?。.！!…，,、~～—-]+$/.test(t)).length,
    long: clean.filter((t) => [...t].length > 60).length,
    punct: +(totalPunct / clean.length).toFixed(2),
    q: clean.filter((t) => QMARK.test(t)).length,
    emoji: clean.filter((t) => EMOJI.test(t)).length,
    self: clean.reduce((n, t) => n + ((t.match(SELFREF) || []).length), 0),
    unique: allChars.size,
    top2,
  }
}

const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'))
const selfTexts = []
const humanTexts = []
for (const conv of Object.values(raw.conversations || {})) {
  for (const m of conv.recentMessages || []) {
    const t = cleanText(m?.text)
    if (!t) continue
    if (m.isSelf) selfTexts.push(t)
    else humanTexts.push(t)
  }
}

const A = stats(selfTexts)
const B = stats(humanTexts)
if (args.json) {
  console.log(JSON.stringify({ self: A, human: B }, null, 2))
  process.exit(0)
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(0) + '%' : '0%')
const line = (name, a, b) => `| ${name} | ${a} | ${b} |`
const out = []
out.push('# 人味体检：小光 vs 群友')
out.push('')
out.push(`数据：${selfTexts.length} 条小光发言 / ${humanTexts.length} 条别人发言（最近 100 条/会话）`)
out.push('')
out.push('| 指标 | 小光 | 别人 |')
out.push('| --- | ---: | ---: |')
out.push(line('平均字数', A.avg, B.avg))
out.push(line('中位数字数', A.median, B.median))
out.push(line('≤10 字占比', pct(A.short, A.n), pct(B.short, B.n)))
out.push(line('≤3 字/纯标点占比', pct(A.tiny, A.n), pct(B.tiny, B.n)))
out.push(line('>60 字占比', pct(A.long, A.n), pct(B.long, B.n)))
out.push(line('标点 / 条', A.punct, B.punct))
out.push(line('带问号占比', pct(A.q, A.n), pct(B.q, B.n)))
out.push(line('带表情占比', pct(A.emoji, A.n), pct(B.emoji, B.n)))
out.push(line('自称「小光」/ 条', +(A.self / Math.max(1, A.n)).toFixed(2), +(B.self / Math.max(1, B.n)).toFixed(2)))
out.push('')
out.push('## 高频二字组')
out.push('')
out.push('- 小光：' + (A.top2.length ? A.top2.map(([g, n]) => `「${g}」×${n}`).join('、') : '无'))
out.push('- 别人：' + (B.top2.length ? B.top2.map(([g, n]) => `「${g}」×${n}`).join('、') : '无'))
out.push('')
out.push('> 读法：不是分越高越好。看三件事——① 字数分布是否接近；② 标点/问号/表情是否同一量级；')
out.push('> ③ 高频二字组是不是口癖（同一个词反复出现）。差太远才叫不人味。')
console.log(out.join('\n'))
