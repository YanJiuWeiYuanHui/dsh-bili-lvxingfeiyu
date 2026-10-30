// 自己拿视频 —— 不再依赖父插件的 debrief。
//
// 只做三件事：
//   ① view    → cid / 时长 / 标题
//   ② playurl → 直链（qn=80 + platform=pc 能拿到 720P）
//   ③ 字幕    → WBI 签名后读 player/wbi/v2，挑中文轨，落成和父插件一样的 `[mm:ss] 文本`
//
// 产物刻意和父插件的文件名保持一致，所以 pick / frame / render 一行都不用改：
//   <DSH_HOME>/shots/video/<BV>-<时间戳>.mp4
//   <DSH_HOME>/shots/subs/<BV>-debrief.txt
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { P, DSH_HOME } from './core.mjs'
import { findMp4, probe } from './media.mjs'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const CRED = path.join(HOME, '.bili-ai', 'credentials.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// 与父插件同一张混淆表（WBI 签名要用）
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
const keyOf = (u) => String(u).slice(String(u).lastIndexOf('/') + 1, String(u).lastIndexOf('.'))

function loadCred() {
  try { return JSON.parse(fs.readFileSync(CRED, 'utf8')) } catch { return {} }
}

// 请求走父插件的闸（预算/冷却/412 暂停）；找不到就自带 1.5s 间隔
async function loadFetch() {
  const cands = [
    path.join(DSH_HOME, 'profiles', 'desktop', 'node_modules', 'dsh-bili-whale', 'tools', 'lib', 'traffic.mjs'),
    path.join(DSH_HOME, 'plugins', 'dsh-bili-whale', 'tools', 'lib', 'traffic.mjs'),
  ]
  for (const c of cands) {
    if (!fs.existsSync(c)) continue
    try {
      const m = await import(pathToFileURL(c).href)
      if (m.guardedFetch) return { fetch: m.guardedFetch, guarded: true }
    } catch {}
  }
  let last = 0
  return {
    guarded: false,
    async fetch(url, opts) {
      const wait = 1500 - (Date.now() - last)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = Date.now()
      return globalThis.fetch(url, opts)
    },
  }
}

function headers(cred) {
  const cookie = `SESSDATA=${cred.sessdata ?? ''}; bili_jct=${cred.bili_jct ?? ''}` + (cred.buvid3 ? `; buvid3=${cred.buvid3}` : '')
  return { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie }
}

/** view：cid / 时长 / 标题 / 封面 */
export async function view(bv, { f, cred }) {
  const r = await f(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, { headers: headers(cred) })
  const j = await r.json()
  if (j.code !== 0) throw new Error(`view 失败 code=${j.code} ${j.message ?? ''}`)
  const d = j.data
  const pages = Array.isArray(d.pages) ? d.pages : []
  const p1 = pages[0]
  return {
    cid: d.cid, aid: d.aid,
    // 多 P 视频：顶层 duration 是所有 P 的总和，抽帧只用到第 1P，所以按 P1 算
    duration: Number(p1?.duration ?? d.duration) || 0,
    totalDuration: Number(d.duration) || 0,
    page: 1, pages: pages.length,
    pageTitles: pages.map((x, i) => `P${i + 1} ${x.part}`).slice(0, 12),
    title: d.title, pic: d.pic, owner: d.owner?.name,
  }
}

/** 直链（qn=80 通常给 720P；有没有 1080 取决于账号权限） */
export async function playurl(bv, cid, { f, cred, qn = 80 }) {
  const u = `https://api.bilibili.com/x/player/playurl?bvid=${bv}&cid=${cid}&qn=${qn}&fnval=1&platform=pc&high_quality=1`
  const r = await f(u, { headers: headers(cred) })
  const j = await r.json()
  if (j.code !== 0) throw new Error(`playurl 失败 code=${j.code} ${j.message ?? ''}（有些视频要登录或只有 dash 流）`)
  const d0 = j.data?.durl?.[0]
  const url = d0?.url
  if (!url) throw new Error('playurl 没给直链（可能只有 dash 流或需要更高权限）')
  return { url, quality: j.data.quality, size: Number(d0?.size) || 0 }
}

/** WBI 签名 */
async function wbiQuery(params, { f, cred }) {
  const nav = await (await f('https://api.bilibili.com/x/web-interface/nav', { headers: headers(cred) })).json()
  const img = nav?.data?.wbi_img?.img_url
  const sub = nav?.data?.wbi_img?.sub_url
  if (!img || !sub) return ''
  const mixin = MIXIN_TAB.map((i) => (keyOf(img) + keyOf(sub))[i]).join('').slice(0, 32)
  const wts = Math.round(Date.now() / 1000)
  const clean = (v) => String(v).replace(/[!'()*]/g, '')
  const q = Object.keys({ ...params, wts }).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean(k === 'wts' ? wts : params[k]))}`).join('&')
  return `${q}&w_rid=${crypto.createHash('md5').update(q + mixin).digest('hex')}`
}

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** 字幕：挑中文轨，落成 `<BV>-debrief.txt`（和父插件同格式，readSubs 直接能读） */
export async function fetchSubs(bv, cid, { f, cred }) {
  try {
    const qs = await wbiQuery({ bvid: bv, cid }, { f, cred })
    if (!qs) return { ok: false, reason: '拿不到 WBI 材料' }
    const j = await (await f(`https://api.bilibili.com/x/player/wbi/v2?${qs}`, { headers: headers(cred) })).json()
    const list = j?.data?.subtitle?.subtitles ?? []
    if (!list.length) return { ok: false, reason: '这条没有官方字幕轨' }
    const pick = list.find((s) => s.lan === 'ai-zh') ?? list.find((s) => s.lan === 'zh-CN') ?? list[0]
    const url = String(pick.subtitle_url ?? '').startsWith('http') ? pick.subtitle_url : 'https:' + pick.subtitle_url
    const body = await (await f(url, { headers: headers(cred) })).json()
    const rows = (body?.body ?? []).map((l) => ({ from: Number(l.from) || 0, text: String(l.content ?? '').trim() })).filter((x) => x.text)
    if (!rows.length) return { ok: false, reason: '字幕是空的' }
    fs.mkdirSync(P.subs, { recursive: true })
    const file = path.join(P.subs, `${bv}-debrief.txt`)
    fs.writeFileSync(file, rows.map((r) => `[${fmt(r.from)}] ${r.text}`).join('\n') + '\n', 'utf8')
    return { ok: true, file, lines: rows.length, lan: pick.lan }
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 160) }
  }
}

/**
 * 保证本机有这条视频的 mp4（没有就下）。
 * @returns {Promise<{ok:boolean, file?:string, meta?:object, subs?:object, fetched?:boolean, error?:string}>}
 */
export async function ensureVideo(bv, { qn = 80, force = false, withSubs = true, log = () => {} } = {}) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(String(bv))) return { ok: false, error: '需要有效 BV 号' }
  const { fetch: f, guarded } = await loadFetch()
  const cred = loadCred()

  // 已经有原片：只在缺字幕时补一下
  const have = force ? null : findMp4(bv)
  if (have) {
    const needSubs = withSubs && !fs.existsSync(path.join(P.subs, `${bv}-debrief.txt`))
    let subs = { ok: true, cached: true }
    let meta = null
    if (needSubs) {
      try {
        meta = await view(bv, { f, cred })
        subs = await fetchSubs(bv, meta.cid, { f, cred })
      } catch (e) { subs = { ok: false, reason: String(e?.message ?? e).slice(0, 120) } }
    }
    return { ok: true, file: have, meta, subs, fetched: false }
  }

  log(`[fetch] ${bv} · 请求闸 ${guarded ? '父插件的' : '自带 1.5s 间隔'}`)

  const info = await view(bv, { f, cred })
  const { url, quality, size } = await playurl(bv, info.cid, { f, cred, qn })

  fs.mkdirSync(P.shots, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = path.join(P.shots, `${bv}-${stamp}.mp4`)
  const tmp = out + '.part'

  // 分段下：B站 CDN 对匿名请求经常到 ~5 分钟就断流，所以按 Range 续传直到拿满
  const total = size || 0
  const CHUNK = 8 * 1024 * 1024
  let got = 0
  let guard = 0
  try {
    fs.writeFileSync(tmp, Buffer.alloc(0))
    while (true) {
      guard += 1
      if (guard > 200) throw new Error('续传次数过多，放弃')
      const r = await f(url, {
        headers: {
          'user-agent': UA,
          referer: 'https://www.bilibili.com/',
          range: `bytes=${got}-`,
        },
      })
      if (!r.ok && r.status !== 206) throw new Error(`下载失败 HTTP ${r.status}（已收 ${got}/${total}）`)
      if (!r.body) throw new Error('下载响应没有 body')
      const before = got
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp, { flags: 'a' }))
      got = fs.statSync(tmp).size
      // 服务端给了总长：拿满就停
      if (total > 0 && got >= total) break
      // 没给总长：只要还有进展就继续，停住就收工
      if (total === 0 && got === before) break
      if (got === before) throw new Error(`续传没有进展（${got}/${total}）`)
    }

    // ① 总长对不上 = 下断了
    if (total > 0 && got !== total) throw new Error(`下载不完整：${got}/${total} 字节`)

    // ② 最终校验：ffmpeg 能不能读出正常时长
    const m = probe(tmp)
    const want = Number(info.duration) || 0
    if (!m.duration || (want > 5 && m.duration < want * 0.9)) {
      throw new Error(`下载的文件不可用（时长 ${m.duration ?? 0}s / 应为 ${want}s；多P视频只下第 1P，见 meta.pages）`)
    }
    fs.renameSync(tmp, out)
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }) } catch {}
    throw e
  }

  const meta = { ...info, quality, file: out, sizeMB: Number((fs.statSync(out).size / 1024 / 1024).toFixed(1)) }
  const subs = withSubs ? await fetchSubs(bv, info.cid, { f, cred }) : { ok: false, reason: '跳过字幕' }
  try { probe(out) } catch {}
  return { ok: true, file: out, meta, subs, fetched: true }
}
