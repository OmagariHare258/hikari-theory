// B站 联系人：列出互关/关注/粉丝，按名字找 mid（2026-11-06 用户要求）
// 为什么加：她会向主人要「群友E的号」，但联系人本来就能自己查 —— 翻不到是缺工具，不是缺数据。
//
// 用法:
//   node contacts.mjs                列出互关好友（默认）
//   node contacts.mjs --q 群友E       按名字筛选
//   node contacts.mjs --all          互关 + 关注 + 粉丝
//   node contacts.mjs --json         输出 JSON
import { accountBili } from '../lib/state-paths.mjs'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[argv[i].slice(2)] = true
    else { opt[argv[i].slice(2)] = v; i += 1 }
  }
}
const Q = String(opt.q ?? '').trim().toLowerCase()
const ALL = !!opt.all
const JSONOUT = !!opt.json

const CRED = accountBili('credentials.json')
const cred = JSON.parse(fs.readFileSync(CRED, 'utf8'))
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const H = {
  'user-agent': UA,
  referer: 'https://www.bilibili.com/',
  cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
}
const jget = async (u) => (await fetch(u, { headers: H })).json()

async function meMid() {
  const nav = await jget('https://api.bilibili.com/x/web-interface/nav')
  if (!nav.data?.isLogin) { console.error('✗ 未登录'); process.exit(3) }
  return String(nav.data.mid)
}

async function listFollowing(mid, pages = 3) {
  const out = []
  for (let pn = 1; pn <= pages; pn += 1) {
    const j = await jget(`https://api.bilibili.com/x/relation/followings?vmid=${mid}&pn=${pn}&ps=50&order=desc&order_type=attention`)
    if (j.code !== 0) break
    const list = j.data?.list ?? []
    out.push(...list.map((x) => ({ mid: String(x.mid), name: String(x.uname ?? '') })))
    if (list.length < 50) break
  }
  return out
}

async function listFollowers(mid, pages = 3) {
  const out = []
  for (let pn = 1; pn <= pages; pn += 1) {
    const j = await jget(`https://api.bilibili.com/x/relation/followers?vmid=${mid}&pn=${pn}&ps=50`)
    if (j.code !== 0) break
    const list = j.data?.list ?? []
    out.push(...list.map((x) => ({ mid: String(x.mid), name: String(x.uname ?? '') })))
    if (list.length < 50) break
  }
  return out
}

const mid = await meMid()
const following = await listFollowing(mid)
const followers = await listFollowers(mid)
const fset = new Set(following.map((x) => x.mid))
const mutual = followers.filter((x) => fset.has(x.mid))

const match = (x) => !Q || x.name.toLowerCase().includes(Q) || x.mid.includes(Q)
const outMutual = mutual.filter(match)
const outFollowing = following.filter(match)
const outFollowers = followers.filter(match)

if (JSONOUT) {
  console.log(JSON.stringify({ self: mid, mutual: outMutual, following: outFollowing, followers: outFollowers }, null, 2))
  process.exit(0)
}

const fmt = (list) => list.map((x) => `  ${x.name || '(无昵称)'}（mid ${x.mid}）`).join('\n') || '  （无）'
console.log(`账号 mid ${mid} · 互关 ${mutual.length} 人 · 关注 ${following.length} · 粉丝 ${followers.length}`)
if (Q) console.log(`筛选「${Q}」：`)
console.log('互关：')
console.log(fmt(outMutual))
if (ALL) {
  console.log('关注（全部）：')
  console.log(fmt(outFollowing))
  console.log('粉丝（全部）：')
  console.log(fmt(outFollowers))
}
if (!outMutual.length && !outFollowing.length && !outFollowers.length) console.log('没找到匹配的联系人')

