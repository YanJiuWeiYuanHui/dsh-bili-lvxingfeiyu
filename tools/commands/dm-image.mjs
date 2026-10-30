#!/usr/bin/env node
// 私信发图 —— 插件自带命令（tools/commands/dm-image.mjs）
//
// 为什么它在这里、而不是留在父插件里：
//   「私信里直接看到图」必须走两条 B 站接口 ——
//     ① x/dynamic/feed/draw/upload_bfs   先把图传到 B 站图床，拿到 image_url
//     ② web_im/v1/web_im/send_msg        msg_type=2 带 url/width/height 发出
//   父插件的 dm.mjs 只发文字（msg_type=1），没有这条通道；
//   而图是本插件生成的，所以这条能力放在本插件里最自然。
//
// 注意：这是本项目里**唯一**直接操作 B 站接口的文件。
//   其余部分（pick / frame / render / album）只读本地素材 + 调生图 API。
//
// 用法:
//   node dm-image.mjs --image <path> [--msg "附言"] --dry
//   node dm-image.mjs --image <path> [--msg "附言"] --go
//   node feiyu.mjs dm-image --image <path> [--msg "附言"] --dry|--go   ← 等价
//
// 三道闸（与父插件 dm.mjs 一致，不接受参数覆盖）：
//   ① 一天只锁定 1 个收信人  ② 只发给 config.owner.mid  ③ 必须互关
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')

// ── 参数 ──
const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[a.slice(2)] = true
    else { opt[a.slice(2)] = v; i += 1 }
  }
}
const IMAGE = String(opt.image ?? '')
let MSG = String(opt.msg ?? '').trim()
const BV = String(opt.bv ?? '').trim()
const DRY = !!opt.dry
const GO = !!opt.go
const die = (m) => { console.error(m); process.exit(2) }

if (!IMAGE) die('用法: --image <图片路径> [--msg "附言"] [--bv BV号] --dry|--go')
if (DRY === GO) die('必须且只能给一个 --dry 或 --go')
if (!fs.existsSync(IMAGE)) die('图片不存在: ' + IMAGE)

// 给了 BV 就把视频链接附在正文后面（私信里能直接点开）
if (BV) {
  const link = `https://www.bilibili.com/video/${BV}/`
  if (!MSG.includes(link)) MSG = (MSG ? MSG + '\n' : '') + link
}

// ── 配置与凭据 ──
const cfgPath = process.env.BILI_WHALE_CONFIG || path.join(DSH_HOME, 'bili-whale.config.json')
let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch {}
const OWNER = String(cfg.owner?.mid ?? '').trim()
const OWNER_NAME = String(cfg.owner?.name ?? '主人')
if (!OWNER) die('✗ 配置里 owner.mid 为空 —— 私信只发给主人，没配就不发')

const CRED = path.join(HOME, '.bili-ai', 'credentials.json')
let cred = {}
try { cred = JSON.parse(fs.readFileSync(CRED, 'utf8')) } catch { die('✗ 读不到凭据：' + CRED) }
if (!cred.sessdata || !String(cred.sessdata).trim()) die('✗ 凭据缺 SESSDATA')
if (!cred.bili_jct || !String(cred.bili_jct).trim()) die('✗ 凭据缺 bili_jct（CSRF）')

const COOKIE = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}` + (cred.buvid3 ? `; buvid3=${cred.buvid3}` : '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REF = 'https://www.bilibili.com/'

// ── 复用父插件的请求闸（预算/冷却/412 暂停/防重复），找不到就自己控节奏 ──
async function loadFetch() {
  const candidates = [
    path.join(DSH_HOME, 'profiles', 'desktop', 'node_modules', 'dsh-bili-whale', 'tools', 'lib', 'traffic.mjs'),
    path.join(DSH_HOME, 'plugins', 'dsh-bili-whale', 'tools', 'lib', 'traffic.mjs'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try { const m = await import(pathToFileURL(c).href); if (m.guardedFetch) return { fetch: m.guardedFetch, guarded: true } } catch {}
    }
  }
  return { fetch: globalThis.fetch, guarded: false }
}

// ── 图床 ──
const kindOf = (b) => {
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  return null
}
const dimsOf = (b, kind) => {
  if (kind === 'png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue }
    const marker = b[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

const today = () => new Date().toLocaleDateString('sv-SE')
const QUOTA = path.join(HOME, '.bili-ai', 'dm-quota.json')
const loadQ = () => { try { return JSON.parse(fs.readFileSync(QUOTA, 'utf8')) } catch { return {} } }
const saveQ = (o) => { fs.mkdirSync(path.dirname(QUOTA), { recursive: true }); fs.writeFileSync(QUOTA, JSON.stringify(o, null, 2) + '\n') }

const buf = fs.readFileSync(IMAGE)
const kind = kindOf(buf)
const dims = kind ? dimsOf(buf, kind) : null
if (!kind) die('✗ 只支持 png / jpg')
if (!dims) die('✗ 解析不出图片尺寸')

const { fetch: f, guarded } = await loadFetch()
const jget = async (u) => (await f(u, { headers: { 'user-agent': UA, referer: REF, cookie: COOKIE } })).json()

// ── 闸 1：我是谁 / 收信人是谁 ──
const nav = await jget('https://api.bilibili.com/x/web-interface/nav')
if (!nav.data?.isLogin) die('✗ 未登录（cookie 失效）')
const me = { mid: String(nav.data.mid), uname: nav.data.uname }
if (me.mid === OWNER) die('✗ 不能给自己发私信（owner.mid 就是当前账号）')

// ── 闸 3：互关 ──
const rel = await jget(`https://api.bilibili.com/x/relation?fid=${OWNER}`)
if (rel.code !== 0) die(`✗ 关系接口 code=${rel.code}，无法确认互关`)
const attr = Number(rel.data?.attribute ?? -1)
if (attr !== 6) die(`✗ 未互关（attribute=${attr}）—— 私信通道要求双方互相关注`)

// ── 闸 1：一天只锁定一个收信人 ──
const q = loadQ()
if (q.date === today() && q.mid && String(q.mid) !== OWNER) {
  die(`✗ 今天已经锁定给 mid ${q.mid} 了 —— 一天只能锁定 1 个收信人`)
}
const used = q.date === today() ? Number(q.count ?? 0) : 0

console.log(`[私信发图] ${me.uname} → ${OWNER_NAME}（mid ${OWNER}）`)
console.log(`  图片: ${IMAGE}`)
console.log(`  类型: ${kind} ${dims.width}x${dims.height} ${(buf.length / 1024).toFixed(0)}KB`)
console.log(`  附言: ${MSG ? MSG.slice(0, 80) : '（无）'}`)
console.log(`  互关 ✓ · 今天第 ${used + 1} 条 · 请求闸: ${guarded ? '父插件的（预算/冷却/暂停）' : '未找到，自带 1.5s 间隔'}`)

if (DRY) {
  console.log('\n[dry] 未上传、未发送。真正执行时会：')
  console.log('  1) POST https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs  (multipart: file_up, category=daily, csrf=***)')
  console.log(`  2) POST https://api.vc.bilibili.com/web_im/v1/web_im/send_msg  (msg_type=2)`)
  // size 用 KB（B 站按 KB 记，用字节会被客户端显示成 "1804.5M"）
  console.log(`     content={"url":<上传返回>, "width":${dims.width}, "height":${dims.height}, "imageType":"${kind}", "size":${Math.round(buf.length / 1024)}（KB）}`)
  console.log(`     正文: ${MSG ? MSG.replace(/\n/g, ' / ') : '（无）'}`)
  process.exit(0)
}

// ── ① 上传到图床 ──
console.log('\n[1/2] 上传图片…')
const fd = new FormData()
fd.append('file_up', new Blob([buf], { type: kind === 'png' ? 'image/png' : 'image/jpeg' }), `upload.${kind}`)
fd.append('category', 'daily')
fd.append('csrf', String(cred.bili_jct))
const up = await f('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
  method: 'POST', headers: { 'user-agent': UA, referer: REF, cookie: COOKIE }, body: fd,
})
const upJson = await up.json().catch(() => ({}))
console.log(`  HTTP ${up.status} code=${upJson.code} ${upJson.message ?? ''}`)
if (upJson.code !== 0 || !upJson.data?.image_url) {
  console.error('  上传失败原文：' + JSON.stringify(upJson).slice(0, 600))
  process.exit(6)
}
const { image_url: url, image_width: w, image_height: h, img_size: kb } = upJson.data
console.log(`  image_url=${url}  ${w}x${h}  ${kb}KB`)

// ── ② 发私信（msg_type=2）──
console.log('[2/2] 发送私信…')
const devIdFile = path.join(HOME, '.bili-ai', 'dev_id')
let devId = ''
try { devId = fs.readFileSync(devIdFile, 'utf8').trim() } catch {}
if (!/^WEB-[0-9A-F-]{20,}$/i.test(devId)) {
  devId = 'WEB-' + crypto.randomUUID().toUpperCase()
  try { fs.mkdirSync(path.dirname(devIdFile), { recursive: true }); fs.writeFileSync(devIdFile, devId + '\n') } catch {}
}

// ⚠️ B 站这些字段的 img_size / size 是按 **KB** 记的（上传接口返回的也是 KB）。
//   之前这里塞的是字节数，客户端把它当 KB 读 → 显示成 "1804.5M" 这种鬼数字。
const kbSize = Math.max(1, Math.round(buf.length / 1024))
const content = {
  url,
  width: Number(w) || dims.width,
  height: Number(h) || dims.height,
  imageType: kind,
  fileType: kind === 'png' ? 'image/png' : 'image/jpeg',
  size: kbSize,
  fileSize: kbSize,
  img_src: url,
  img_width: Number(w) || dims.width,
  img_height: Number(h) || dims.height,
  img_size: Number.isFinite(Number(kb)) && Number(kb) > 0 ? Math.round(Number(kb)) : kbSize,
}
// 附言作为独立的一条文本（B 站私信一条消息只能是一种类型）
async function send(kindType, msgContent) {
  const body = new URLSearchParams()
  body.set('msg[sender_uid]', me.mid)
  body.set('msg[receiver_id]', OWNER)
  body.set('msg[receiver_type]', '1')
  body.set('msg[msg_type]', String(kindType))
  body.set('msg[msg_status]', '0')
  body.set('msg[timestamp]', String(Math.floor(Date.now() / 1000)))
  body.set('msg[dev_id]', devId)
  body.set('msg[content]', JSON.stringify(msgContent))
  body.set('csrf', String(cred.bili_jct))
  const r = await f('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', {
    method: 'POST',
    headers: { 'user-agent': UA, referer: REF, cookie: COOKIE, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    waitWriteMs: 180000,
  })
  const j = await r.json().catch(() => ({}))
  return { http: r.status, code: j.code, message: j.message, data: j.data }
}

if (MSG) {
  const t = await send(1, { content: MSG.slice(0, 300) })
  console.log(`  附言: HTTP ${t.http} code=${t.code} ${t.message ?? ''}`)
  if (t.code === 0) saveQ({ date: today(), count: loadQ().date === today() ? Number(loadQ().count ?? 0) + 1 : 1, mid: OWNER, at: new Date().toISOString() })
  await new Promise((r) => setTimeout(r, 1200))
}

const r = await send(2, content)
console.log(`  图片: HTTP ${r.http} code=${r.code} ${r.message ?? ''}`)
if (r.code !== 0) {
  console.error('  发送失败原文：' + JSON.stringify(r).slice(0, 800))
  console.error('  （msg_type=2 的报文结构可能和平台要求不一致；把这段原文发我，我按它调）')
  process.exit(1)
}
const nq = loadQ()
saveQ({ date: today(), count: (nq.date === today() ? Number(nq.count ?? 0) : 0) + 1, mid: OWNER, at: new Date().toISOString() })
console.log('  ✓ 已发出（图片）')
process.exit(0)
