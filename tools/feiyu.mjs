#!/usr/bin/env node
// dsh-bili-lvxingfeiyu —— 打卡 CLI
//
// 设计约束（别破坏）：
//   ① 不碰网络去 B 站：只读父插件已经下到本地的 mp4 / 字幕
//   ② 密钥只在进程内读，绝不作为参数、绝不打印
//   ③ 失败原样透传，不降级、不静默重试
//   ④ 每条命令都能单独跑，人可以直接用，模型也能直接用
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  P, ROOT, DSH_HOME, ensureDirs, readConfig, writeConfig, readSecret, writeSecret,
  readQuota, quotaLeft, bumpQuota, albumAppend, albumList, draftRead, draftWrite,
  today, nowISO, readJson, writeJsonAtomic,
} from './lib/core.mjs'
import { findMp4, readSubs, probe, frameAt, burst, fmtTime, parseTime, requireFfmpeg, ffmpegPath } from './lib/media.mjs'
import { listModels, generate, sizeFor } from './lib/imageapi.mjs'
import { findParentBili, parentState, parentSelftest, runParent } from './lib/parent.mjs'
import { rulesStatus, rulesAttach, rulesDetach, FEIYU_CMD } from './lib/rules.mjs'
import { ensureVideo } from './lib/fetch.mjs'
import { journalPath, readJournal, writeJournal, listJournal, buildJournalPrompt, personaText } from './lib/journal.mjs'
import { chat, journalModel } from './lib/llm.mjs'

// 插件根目录（可选模块 tools/optional/* 从这里定位）
const PLUGIN_ROOT = path.resolve(path.dirname(FEIYU_CMD), '..')

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
const flags = new Set()
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) { flags.add(a.slice(2)); opt[a.slice(2)] = true }
    else { opt[a.slice(2)] = v; i += 1 }
  } else if (!opt._a) opt._a = a
}
const has = (k) => flags.has(k) || opt[k] === true
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n')
const log = (...a) => process.stderr.write(a.join(' ') + '\n')
const die = (o) => { out({ ok: false, ...o }); process.exit(1) }

const TIME_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/

function resolveTime(s) {
  const sec = parseTime(s)
  if (!Number.isFinite(sec) || sec < 0) die({ error: `时间格式不对：${s}（要 mm:ss）` })
  return sec
}

function enabledRefs(cfg) {
  const idx = readJson(P.refsIndex, { items: [] }) || { items: [] }
  const items = Array.isArray(idx.items) ? idx.items : []
  return items.filter((x) => x.enabled !== false)
    .map((x) => ({ ...x, path: path.join(P.refs, x.file) }))
    .filter((x) => { try { return fs.statSync(x.path).isFile() } catch { return false } })
}

function clearOldTmp(days = 2) {
  try {
    const cut = Date.now() - days * 86400000
    for (const n of fs.readdirSync(P.tmp)) {
      const f = path.join(P.tmp, n)
      try { if (fs.statSync(f).mtimeMs < cut) fs.rmSync(f, { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

// 提示词骨架：**人物一致性 + 结构稳定 + 动作由内容决定** 三件事写死在代码里，
// 不指望模型每次都想起来。判定卡只负责"这一帧里她该做什么"。
function buildPrompt(cfg, card, refs) {
  const appearance = String(cfg.character?.note ?? '').trim()
    || refs.map((r) => String(r.note ?? '').trim()).filter(Boolean).join('；')
    || '与参考图完全一致的角色'
  const n = Math.max(0, refs.length)

  const L = []
  L.push(`第一张图是场景（视频里的一帧），必须保留它的构图、建筑、透视、材质和光线；` +
    (n ? `后面 ${n} 张是同一个角色的设定参考，画的就是这个角色。` : '把角色画进这个场景。'))
  L.push(`角色外观（必须与参考图一致）：${appearance}。`)
  if (n >= 1) L.push('参考图是同一个角色的多个视角/细节图 —— **只用来对齐外貌，绝对不要把多个视角拼进同一张画面**（最典型的崩坏就是拼出多余的肢体和尾巴）。')
  L.push('')

  if (card.line) L.push(`【这一刻的内容】${String(card.line).slice(0, 160)}`)
  L.push(`【她在这里做什么】${String(card.action ?? '').trim()
    || '按场景里正在发生的事，做一个自然、克制的小动作（不要摆拍，也不要套用固定姿势）'}`)
  if (card.emotion) L.push(`【情绪】${String(card.emotion).slice(0, 40)}`)
  if (card.why) L.push(`【为什么是这一刻】${String(card.why).slice(0, 120)}`)
  if (card.prompt) L.push(`【补充描述】${String(card.prompt).slice(0, 400)}`)
  L.push('')

  L.push('【硬性要求】')
  L.push(`- 动作必须由这个场景的内容决定（画面里有什么、正在发生什么，就回应什么），` +
    `**不要默认提裙摆**——提裙摆只在场景明显需要时才行`)
  const standText = { left: '画面左侧', center: '画面中央', right: '画面右侧' }[card.stand] ?? '画面右侧'
  const distText = { near: '近景（半身左右）', mid: '中景（大半身）', far: '远景（全身、在画面里偏小）' }[card.distance] ?? '中景'
  // 「朝向」要翻成人话，不然模型会一律画成正脸
  const facingText = {
    back: '背对镜头 —— 只看得到背影、头发和一点侧脸轮廓，**不要回头正对镜头**',
    side: '侧身 —— 身体侧向一边，脸朝画面内侧，**不要正对镜头**',
    front: '面向镜头',
  }[card.facing] ?? '自然朝向'
  L.push(`- 站位：${standText} · 距离：${distText} · 朝向：${facingText} · ` +
    `地平线在画面${({ upper: '上三分之一', middle: '中间', lower: '下三分之一' })[card.horizon] ?? '中间'}附近`)
  L.push('- 人物一致性：发色、瞳色、发饰、服装剪裁、围裙、尾巴的形状与颜色，全部与参考图一致；按正常人体比例画')
  L.push('- 结构稳定：正好两条手臂、两只手、每只手五个手指；头部与颈部、躯干连接自然')
  L.push('- **角色必须完整在画幅内**：头顶到脚、包括尾巴的末端，都不许被画面边缘切掉；宁可比场景小一点，也不要裁掉肢体')
  L.push('- 尾巴：只有一条，从腰后自然长出，与身体有连续的连接过渡（不是贴上去的一截），粗细均匀，末端是**完整的尾鳍**，朝向合理、不穿过身体')
  L.push('- 光影跟随场景：她身上要有与场景一致的高光，脚下（或身后的墙面）有落在正确位置的阴影')
  L.push('- 只加她一个人，不新增其他角色；不重绘背景里的建筑、标识和道具')

  const neg = [cfg.prompt?.negative, card.negative].map((x) => String(x ?? '').trim()).filter(Boolean).join('、')
  if (neg) L.push('')
  if (neg) L.push(`【避免出现】${neg}`)
  return L.join('\n')
}

function renderText(tpl, rec, override) {
  if (override) return String(override)
  return String(tpl || '{line}')
    .replaceAll('{line}', String(rec.card?.why ?? '').slice(0, 120))
    .replaceAll('{bv}', String(rec.bv ?? ''))
    .replaceAll('{time}', String(rec.t ?? ''))
    .replaceAll('{id}', String(rec.id ?? ''))
    .replaceAll('{url}', rec.bv ? `https://www.bilibili.com/video/${rec.bv}/` : '')
    .trim()
}

// ── status ────────────────────────────────────────────────────────────────
function cmdStatus() {
  const cfg = readConfig()
  const secret = readSecret()
  const q = readQuota()
  const parent = parentState(cfg)
  const rules = rulesStatus()
  const refs = enabledRefs(cfg)
  let mp4 = 0
  try { mp4 = fs.readdirSync(P.shots).filter((n) => n.toLowerCase().endsWith('.mp4')).length } catch {}
  const album = albumList(1000)
  const d = draftRead()
  const todayAlbum = album.filter((x) => String(x.at ?? '').slice(0, 10) === today())
  out({
    ok: true,
    enabled: cfg.enabled !== false,
    mode: cfg.mode,
    daily: cfg.daily,
    used: q.count,
    remaining: quotaLeft(cfg),
    perVideo: cfg.perVideo,
    reason: cfg.enabled === false ? '总开关关着'
      : quotaLeft(cfg) <= 0 ? `今天额度已用完（${q.count}/${cfg.daily}）` : '可以打卡',
    api: { endpoint: cfg.api?.endpoint, model: cfg.api?.model, size: cfg.api?.size, keyPresent: secret.present },
    refs: { enabled: refs.length, names: refs.map((r) => ({ file: r.file, note: r.note })) },
    album: { total: album.length, today: todayAlbum.length, last: album[0] ?? null },
    queue: d.items.length,
    parent: { found: parent.found, bili: parent.bili, credentials: parent.credentials },
    rules,
    ffmpeg: ffmpegPath(),
    shots: { dir: P.shots, mp4 },
    paths: { config: P.config, secret: P.secret, album: P.album, refs: P.refs },
  })
}

// ── secret（只写，永不回显） ──────────────────────────────────────────────
function cmdSecret() {
  const sub = opt._a ?? 'status'
  if (sub === 'status') { const s = readSecret(); out({ ok: true, present: s.present }); return }
  if (sub === 'set') {
    const key = fs.readFileSync(0, 'utf8').trim()
    if (key.length < 8) die({ error: '密钥太短' })
    writeSecret(key)
    out({ ok: true, present: true, note: '已保存（不回显）；建议用设置页填，别贴在命令行里' })
    return
  }
  if (sub === 'clear') { writeSecret(''); out({ ok: true, present: false }); return }
  die({ error: '用法: secret status | set（从 stdin 读） | clear' })
}

// ── models ────────────────────────────────────────────────────────────────
async function cmdModels() {
  const cfg = readConfig()
  const secret = readSecret()
  if (!secret.present) die({ error: '还没填 API 密钥' })
  const r = await listModels({
    endpoint: cfg.api.endpoint,
    apiKey: secret.apiKey,
    extraHeaders: cfg.api.extraHeaders ?? {},
    timeoutMs: 30000,
  })
  out(r)
}

// ── refs ──────────────────────────────────────────────────────────────────
function cmdRefs() {
  ensureDirs()
  const idx = readJson(P.refsIndex, { items: [] }) || { items: [] }
  if (!Array.isArray(idx.items)) idx.items = []
  const sub = opt._a
  if (!sub || sub === 'list') { out({ ok: true, items: idx.items }); return }

  if (sub === 'add') {
    const src = String(opt.file ?? '').trim()
    if (!src) die({ error: '需要 --file <图片路径>' })
    if (!fs.existsSync(src)) die({ error: `图片不存在：${src}` })
    const note = String(opt.note ?? path.basename(src))
    const ext = path.extname(src).toLowerCase() || '.png'
    const name = String(opt.name ?? (crypto.randomUUID().slice(0, 8) + ext))
    const dest = path.join(P.refs, name)
    fs.copyFileSync(src, dest)
    idx.items = idx.items.filter((x) => x.file !== name)
    idx.items.push({ file: name, note, enabled: true, addedAt: nowISO() })
    writeJsonAtomic(P.refsIndex, idx)
    out({ ok: true, added: { file: name, note }, total: idx.items.length })
    return
  }

  if (sub === 'rm') {
    const name = String(opt.file ?? opt.name ?? '').trim()
    idx.items = idx.items.filter((x) => x.file !== name)
    writeJsonAtomic(P.refsIndex, idx)
    try { fs.rmSync(path.join(P.refs, name), { force: true }) } catch {}
    out({ ok: true, removed: name, total: idx.items.length })
    return
  }

  if (sub === 'note') {
    const name = String(opt.file ?? '').trim()
    const hit = idx.items.find((x) => x.file === name)
    if (!hit) die({ error: `没有这张参考图：${name}` })
    hit.note = String(opt.note ?? '')
    writeJsonAtomic(P.refsIndex, idx)
    out({ ok: true, item: hit })
    return
  }

  if (sub === 'toggle') {
    const name = String(opt.file ?? '').trim()
    const hit = idx.items.find((x) => x.file === name)
    if (!hit) die({ error: `没有这张参考图：${name}` })
    hit.enabled = hit.enabled === false
    writeJsonAtomic(P.refsIndex, idx)
    out({ ok: true, item: hit })
    return
  }

  die({ error: '用法: refs list | add --file <图> [--note "…"] [--name x.png] | rm --file <名> | note --file <名> --note "…" | toggle --file <名>' })
}

// ── 取片：本机没有就自己下（C 的核心）────────────────────────────────────
async function ensureMp4(bv) {
  const have = findMp4(bv)
  if (have) return have
  if (has('no-fetch')) return null
  log(`[fetch] 本机没有 ${bv} 的原片 → 自己下`)
  const r = await ensureVideo(bv, {
    qn: Number(opt.qn) || 80,
    force: has('force'),
    log: (m) => log(m),
  })
  if (!r?.ok) throw new Error(r?.error || '下载失败')
  log(`[fetch] ok · ${r.file}${r.subs?.ok ? ' · 字幕 ' + (r.subs.lines ?? '缓存') + ' 行' : ' · 无字幕'}`)
  return r.file
}

// ── fetch ─────────────────────────────────────────────────────────────────
async function cmdFetch() {
  ensureDirs()
  const bv = String(opt._a ?? opt.bv ?? '').trim()
  if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) die({ error: '需要有效 BV 号' })
  try {
    const r = await ensureVideo(bv, { qn: Number(opt.qn) || 80, force: has('force'), log: (m) => log(m) })
    out(r)
  } catch (e) { die({ error: String(e?.message ?? e) }) }
}

// ── pick ──────────────────────────────────────────────────────────────────
async function cmdPick() {
  ensureDirs(); clearOldTmp()
  const bv = String(opt._a ?? opt.bv ?? '').trim()
  if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) die({ error: '需要有效 BV 号' })
  const cfg = readConfig()
  let mp4
  try { mp4 = await ensureMp4(bv) } catch (e) { die({ error: String(e.message) }) }
  if (!mp4) die({ error: `本机没有这条视频的 mp4，且加了 --no-fetch` })
  const meta = probe(mp4)
  if (!meta.duration) die({ error: '读不到视频时长（ffprobe/ffmpeg 有问题？）' })
  const subs = readSubs(bv)
  const N = Math.max(1, Math.min(6, Number(opt.segments ?? cfg.candidates.segments) || 3))
  const B = Math.max(1, Math.min(12, Number(opt.burst ?? cfg.candidates.burst) || 7))
  const win = Math.max(2, Number(opt.window ?? cfg.candidates.windowSec) || 6)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  let centers = []
  if (opt.around !== undefined) {
    centers = [resolveTime(String(opt.around))]
  } else {
    for (let i = 0; i < N; i += 1) {
      const lo = (meta.duration * i) / N
      const hi = (meta.duration * (i + 1)) / N
      let c = (lo + hi) / 2
      // 有字幕就吸附到这一段里最靠近中心的字幕时刻
      if (subs.length) {
        const near = subs.map((s) => s.sec).filter((s) => s >= lo && s <= hi)
        if (near.length) c = near.reduce((a, b) => (Math.abs(b - c) < Math.abs(a - c) ? b : a), near[0])
      }
      centers.push(c)
    }
  }

  const segments = centers.map((c, i) => {
    const from = Math.max(0, c - win / 2)
    const to = Math.min(meta.duration - 0.2, c + win / 2)
    const dir = path.join(P.tmp, `pick-${stamp}`, 'seg' + (i + 1))
    const thumbs = burst(mp4, from, to, B, dir)
    const lines = subs.filter((s) => s.sec >= from - 2 && s.sec <= to + 2).map((s) => ({ time: fmtTime(s.sec), text: s.text }))
    return { index: i + 1, center: fmtTime(c), from: fmtTime(from), to: fmtTime(to), lines, thumbs }
  }).filter((s) => s.thumbs.length)

  out({
    ok: true,
    bv,
    mp4,
    duration: Math.round(meta.duration),
    ar: Number(meta.ar.toFixed(3)),
    size: sizeFor(meta.ar, cfg.api?.size),
    segments,
    next: `看缩略图 → 按 prompts/rubric.md 写判定卡 → node "${FEIYU_CMD}" render --bv ${bv} --at <mm:ss> --card <card.json>`,
  })
}

// ── frame ─────────────────────────────────────────────────────────────────
async function cmdFrame() {
  ensureDirs()
  const bv = String(opt._a ?? opt.bv ?? '').trim()
  if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) die({ error: '需要有效 BV 号' })
  if (opt.at === undefined) die({ error: '需要 --at mm:ss' })
  const sec = resolveTime(String(opt.at))
  let mp4
  try { mp4 = await ensureMp4(bv) } catch (e) { die({ error: String(e.message) }) }
  if (!mp4) die({ error: '本机没有这条视频的 mp4，且加了 --no-fetch' })
  const dest = String(opt.out ?? path.join(P.frames, `${bv}-${fmtTime(sec).replace(':', '')}.jpg`))
  frameAt(mp4, sec, dest)
  const meta = probe(mp4)
  out({ ok: true, file: dest, sec, time: fmtTime(sec), ar: Number(meta.ar.toFixed(3)), size: sizeFor(meta.ar, readConfig().api?.size) })
}

// ── render ────────────────────────────────────────────────────────────────
async function cmdRender() {
  ensureDirs()
  const cfg = readConfig()
  const secret = readSecret()
  const draftId = opt.draft ? String(opt.draft) : null
  let job = null

  if (draftId) {
    const d = draftRead()
    job = d.items.find((x) => x.id === draftId)
    if (!job) die({ error: `队列里没有这条：${draftId}` })
  } else {
    const bv = String(opt.bv ?? '').trim()
    if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) die({ error: '需要 --bv BV号' })
    if (opt.at === undefined) die({ error: '需要 --at mm:ss' })
    const at = String(opt.at)
    const cardRaw = opt.card === undefined ? null : (opt.card === '-' ? fs.readFileSync(0, 'utf8') : (() => {
      const f = String(opt.card)
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : f
    })())
    if (!cardRaw) die({ error: '需要 --card <判定卡.json>（或 --card - 从 stdin 读）' })
    let card
    try { card = JSON.parse(String(cardRaw).replace(/^\uFEFF/, '')) } catch (e) { die({ error: '判定卡不是合法 JSON：' + e.message }) }
    if (card.can !== true) {
      out({ ok: true, skipped: true, reason: card.reject ?? '判定卡 can=false', card })
      return
    }
    if (!card.prompt || String(card.prompt).trim().length < 10) die({ error: '判定卡缺 prompt（至少 10 字）' })
    job = {
      id: crypto.randomUUID().slice(0, 8),
      bv, t: at, tSec: resolveTime(at), card,
      createdAt: nowISO(),
    }
  }

  // 额度只在**真正生成**时才卡：入队不花钱，可以先攒着明天再生成
  if (cfg.enabled === false) die({ error: '打卡总开关关着（设置 → 旅行肥鱼 → 启用）' })
  const q = readQuota()
  if (q.byBv[job.bv] && Number(cfg.perVideo ?? 1) <= 1) die({ error: `这条视频今天已经打过卡了（${job.bv}）` })

  // 取帧（本机没有就自己下）
  let mp4
  try { mp4 = await ensureMp4(job.bv) } catch (e) { die({ error: String(e.message) }) }
  if (!mp4) die({ error: '本机没有这条视频的 mp4，且加了 --no-fetch' })
  const meta = probe(mp4)
  const framePath = path.join(P.frames, `${job.bv}-${String(job.t).replace(/[:.]/g, '')}.jpg`)
  if (!job.frame || !fs.existsSync(job.frame)) frameAt(mp4, job.tSec, framePath)
  job.frame = fs.existsSync(framePath) ? framePath : job.frame

  const refs = enabledRefs(cfg)
  // --line：那一刻的字幕（模型从 debrief 输出里抄过来），写进判定卡再进提示词
  if (opt.line && !job.card.line) job.card.line = String(opt.line)
  const prompt = buildPrompt(cfg, job.card, refs)
  const size = sizeFor(meta.ar, cfg.api?.size)
  job.prompt = prompt
  job.size = size
  job.refs = refs.map((r) => r.file)

  if (!secret.present) die({ error: '还没填 API 密钥（设置 → 旅行肥鱼 → API）' })

  // 预演：不发任何请求
  if (has('dry')) {
    out({
      ok: true, dry: true,
      wouldPost: refs.length ? 'POST ' + String(cfg.api.endpoint).replace(/\/+$/, '') + '/images/edits（multipart）'
        : 'POST ' + String(cfg.api.endpoint).replace(/\/+$/, '') + '/images/generations（json）',
      model: cfg.api.model, size, prompt,
      refs: [{ file: job.frame, note: '场景帧' }, ...refs.map((r) => ({ file: r.path, note: r.note }))],
      apiKey: '***（不进请求体之外的任何地方）',
    })
    return
  }

  // 人工审图：只入队
  if (cfg.mode !== 'auto' && !draftId && !has('force')) {
    const d = draftRead()
    job.status = 'pending'
    d.items = [...d.items.filter((x) => x.id !== job.id), job]
    draftWrite(d)
    out({ ok: true, queued: job.id, mode: cfg.mode, message: '已入队，去设置 → 旅行肥鱼 → 待打卡 里点生成', job: { id: job.id, bv: job.bv, t: job.t, frame: job.frame, prompt } })
    return
  }

  const t0 = Date.now()
  // 真正要花钱了，这时候才卡日额度
  if (q.count >= Number(cfg.daily ?? 1)) die({ error: `今天额度已用完（${q.count}/${cfg.daily}），明天再来；草稿会留在队列里` })
  const r = await generate({
    endpoint: cfg.api.endpoint,
    apiKey: secret.apiKey,
    model: cfg.api.model,
    size,
    prompt,
    refs: [job.frame, ...refs.map((x) => x.path)],
    extraHeaders: cfg.api.extraHeaders ?? {},
    timeoutMs: Number(cfg.api.timeoutMs ?? 180000),
  })

  // id 必须唯一：同一条 BV 同一时刻再生成一次时，加序号，避免同名覆盖旧图
  const base = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(job.bv)}-${String(job.t).replace(':', '')}`
  let id = base
  for (let n = 2; fs.existsSync(path.join(P.album, id + '.png')); n += 1) id = `${base}-${n}`
  const rec = {
    id, at: nowISO(), bv: job.bv, t: job.t, tSec: job.tSec,
    frame: job.frame, out: null, prompt, refs: job.refs,
    model: cfg.api.model, endpoint: cfg.api.endpoint,
    sizeRequested: size, sizeActual: null,
    ms: Date.now() - t0, usage: r.usage ?? null,
    card: job.card, ok: !!r.ok, error: null, mode: r.mode,
    published: [],
  }

  if (!r.ok) {
    rec.error = r.error ?? r.raw ?? '未知错误'
    rec.http = r.http
    albumAppend(rec)
    out({ ok: false, ...rec })
    process.exit(1)
  }

  const outFile = path.join(P.album, id + '.png')
  fs.writeFileSync(outFile, r.buf)
  rec.out = outFile
  try { const m = probe(outFile); rec.sizeActual = `${m.width}x${m.height}` } catch {}
  albumAppend(rec)
  bumpQuota(job.bv)
  autoClean(cfg)   // 只删重复/过期的原片，刚下的那条留着

  if (draftId) {
    const d = draftRead()
    d.items = d.items.filter((x) => x.id !== draftId)
    draftWrite(d)
  }

  const pMode = cfg.publish?.mode ?? 'manual'
  const good = job.card.can === true && Number(job.card.score ?? 0) >= Number(cfg.publish?.minScore ?? 13)
  if (pMode === 'auto' || (pMode === 'auto-if-good' && good)) {
    const pub = publishRecord(rec, cfg, { dry: false })
    rec.published = pub.results
    albumUpdateById(rec.id, { published: pub.results })   // 原地更新，不追加新行
    out({ ok: true, ...rec, published: pub.results })
    return
  }
  out({ ok: true, ...rec, published: [], message: '已出图，发布模式=' + pMode })
}

// ── publish ───────────────────────────────────────────────────────────────
function publishRecord(rec, cfg, { dry = false, text } = {}) {
  const dest = Array.isArray(cfg.publish?.dest) ? cfg.publish.dest : ['album']
  const msg = renderText(cfg.publish?.textTemplate, rec, text)
  const results = []
  for (const d of dest) {
    if (d === 'album') { results.push({ dest: 'album', ok: true, note: rec.out }); continue }

    if (d === 'desktop') {
      results.push(desktopNotice('打卡完成', msg))
      continue
    }

    if (d === 'dynamic') {
      const bili = findParentBili(cfg)
      const args = ['dynamic-image', '--image', rec.out, '--text', msg, '--auto', dry ? '--dry' : '--go']
      const r = runParent(bili, args, { timeoutMs: 300000, dry: false })
      results.push({ dest: 'dynamic', ok: r.ok, code: r.code, stdout: r.stdout.slice(-800), stderr: r.stderr.slice(-400), argv: ['dynamic-image', '--image', '<图>', '--text', '<正文>', dry ? '--dry' : '--go'] })
      continue
    }

    if (d === 'comment') {
      const oid = rec.card?.oid ?? cfg.publish?.comment?.oid
      if (!oid) { results.push({ dest: 'comment', ok: false, stderr: '缺少 oid（判定卡里加 oid，或设置里填）' }); continue }
      const bili = findParentBili(cfg)
      const args = ['comment', '--oid', String(oid), '--bvid', rec.bv, '--message', msg,
        '--share', '--auto', '--reason', String(cfg.publish?.comment?.reason ?? '她在视频里找到了一个值得站进去的地方'),
        '--score', String(rec.card?.score ?? cfg.publish?.minScore ?? 13), '--rank', '1',
        dry ? '--dry' : '--go']
      const r = runParent(bili, args, { timeoutMs: 360000 })
      results.push({ dest: 'comment', ok: r.ok, code: r.code, stdout: r.stdout.slice(-600), stderr: r.stderr.slice(-400) })
      continue
    }

    if (d === 'dm') {
      const link = rec.dynUrl ? ' ' + rec.dynUrl : ''
      const body = (msg + link).slice(0, 290)
      const bili = findParentBili(cfg)
      const r = runParent(bili, ['dm', '--msg', body, dry ? '--dry' : '--go'], { timeoutMs: 300000 })
      results.push({ dest: 'dm', ok: r.ok, code: r.code, stdout: r.stdout.slice(-600), stderr: r.stderr.slice(-400) })
      continue
    }

    // 私信**带图**：图床 + msg_type=2（本项目唯一直接碰 B 站接口的地方）
    if (d === 'dm-image') {
      const script = path.join(PLUGIN_ROOT, 'tools', 'commands', 'dm-image.mjs')
      if (!fs.existsSync(script)) {
        results.push({ dest: 'dm-image', ok: false, stderr: '找不到 tools/commands/dm-image.mjs' })
        continue
      }
      // --bv：把视频链接一起附上（私信里能直接点开）
      const args = [script, '--image', rec.out, '--msg', msg.slice(0, 240), ...(rec.bv ? ['--bv', String(rec.bv)] : []), dry ? '--dry' : '--go']
      try {
        const outText = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 300000, windowsHide: true })
        results.push({ dest: 'dm-image', ok: true, stdout: outText.slice(-800) })
      } catch (e) {
        results.push({ dest: 'dm-image', ok: false, code: e.status ?? -1, stdout: String(e.stdout ?? '').slice(-600), stderr: String(e.stderr ?? e.message).slice(-600) })
      }
      continue
    }

    results.push({ dest: d, ok: false, stderr: '不支持的目标：' + d })
  }
  return { text: msg, results }
}

function desktopNotice(title, text) {
  try {
    const ps = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
      '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null',
      '"<toast><visual><binding template=""ToastGeneric""><text></text><text></text></binding></visual></toast>" | Out-File -Encoding utf8 $env:DK_XML',
      '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
      '$x.LoadXml([IO.File]::ReadAllText($env:DK_XML))',
      '$n = $x.GetElementsByTagName("text")',
      '$n.Item(0).AppendChild($x.CreateTextNode($env:DK_TITLE)) | Out-Null',
      '$n.Item(1).AppendChild($x.CreateTextNode($env:DK_TEXT)) | Out-Null',
      '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("dsh-bili-lvxingfeiyu").Show([Windows.UI.Notifications.ToastNotification]::new($x))',
      'Remove-Item $env:DK_XML -Force -ErrorAction SilentlyContinue',
    ].join('\n')
    const dir = P.tmp
    fs.mkdirSync(dir, { recursive: true })
    const ps1 = path.join(dir, `toast-${Date.now()}.ps1`)
    const xml = path.join(dir, `toast-${Date.now()}.xml`)
    fs.writeFileSync(ps1, ps, 'utf8')
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
        env: { ...process.env, DK_TITLE: String(title), DK_TEXT: String(text).slice(0, 200), DK_XML: xml },
        encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
      })
    } finally { try { fs.rmSync(ps1, { force: true }); fs.rmSync(xml, { force: true }) } catch {} }
    return { dest: 'desktop', ok: true }
  } catch (e) {
    return { dest: 'desktop', ok: false, stderr: String(e?.message ?? e).slice(0, 200) }
  }
}

// 按 id 原地更新一条记录（发布时不追加新行）
function albumUpdateById(id, patch) {
  const rows = albumList(100000)
  let hit = 0
  const next = rows.map((r) => {
    if (r.id !== id) return r
    hit += 1
    return { ...r, ...patch }
  })
  if (hit) {
    const lines = next.slice().reverse().map((r) => JSON.stringify(r)).join('\n') + '\n'
    fs.writeFileSync(P.albumIndex, lines, 'utf8')
  }
  return hit
}

function cmdPublish() {
  const cfg = readConfig()
  const idOrPath = String(opt.id ?? opt._a ?? '').trim()
  if (!idOrPath) die({ error: '需要 --id <相册ID> 或图片绝对路径' })
  let rec
  if (fs.existsSync(idOrPath)) {
    rec = { id: path.basename(idOrPath, path.extname(idOrPath)), out: idOrPath, bv: '', t: '', card: { why: '' } }
  } else {
    rec = albumList(1000).find((x) => x.id === idOrPath)
    if (!rec) die({ error: `相册里没有：${idOrPath}` })
  }
  if (!rec.out || !fs.existsSync(rec.out)) die({ error: '图片不在了：' + rec.out })
  const dry = has('dry')
  const r = publishRecord(rec, cfg, { dry, text: opt.text ? String(opt.text) : undefined })
  if (!dry) albumUpdateById(rec.id, { published: r.results })
  out({ ok: r.results.every((x) => x.ok), dry, text: r.text, dest: cfg.publish?.dest, results: r.results })
}

// ── clean：收拾硬盘 ───────────────────────────────────────────────────────
//   三类分开管，各自可设过期天数：
//     videos  原片（最占地方，一晚几百 MB）
//     albums  打卡图（是"作品"，默认不自动删）
//     tmp     选景缩略图（随时可重建）
//   用法：
//     daka clean                      按配置的各自天数清三类
//     daka clean --only videos,tmp    只清指定类
//     daka clean --dry                只看会删什么
//     daka clean --days-videos 7      临时改某类的天数
const CLEAN_KEYS = ['videos', 'albums', 'tmp']

function cleanCfg(cfg) {
  const c = cfg.clean || {}
  const pick = (k, dflt) => {
    const v = c[k]
    if (typeof v === 'number') return { auto: true, days: v, keepPerBv: 1 }   // 兼容旧配置
    return { ...dflt, ...(v && typeof v === 'object' ? v : {}) }
  }
  return {
    videos: pick('videos', { auto: true, days: 2, keepPerBv: 1 }),
    albums: pick('albums', { auto: false, days: 0 }),
    tmp: pick('tmp', { auto: true, days: 2 }),
  }
}

/** 算出要删什么。返回 [{ file, bytes, kind, why }] */
function planClean(cfg, { only, all = false, inherit = {} } = {}) {
  const c = cleanCfg(cfg)
  const want = (k) => !only || only.includes(k)
  const jobs = []
  const sizeOf = (f) => { try { const s = fs.statSync(f); return s.isFile() ? s.size : 0 } catch { return 0 } }
  const dirSize = (d) => { try { return fs.readdirSync(d).reduce((n, x) => n + sizeOf(path.join(d, x)), 0) } catch { return 0 } }

  // ① 原片：先按 BV 去重（每 BV 留 keepPerBv 份），再按天数
  if (want('videos')) {
    const v = { ...c.videos, ...(inherit.videos || {}) }
    const days = Math.max(0, Number(opt['days-videos'] ?? v.days ?? 2))
    const keepPerBv = Math.max(0, Number(opt['keep-per-bv'] ?? v.keepPerBv ?? 1))
    const cutoff = Date.now() - days * 86400000
    try {
      const files = fs.readdirSync(P.shots)
        .filter((n) => n.toLowerCase().endsWith('.mp4'))
        .map((n) => { const f = path.join(P.shots, n); const st = fs.statSync(f); return { f, n, at: st.mtimeMs, bytes: st.size, bv: n.split('-')[0] } })
        .sort((a, b) => b.at - a.at)
      const seen = {}
      for (const x of files) {
        seen[x.bv] = (seen[x.bv] ?? 0) + 1
        if (all) { jobs.push({ file: x.f, n: x.n, bytes: x.bytes, kind: 'videos', why: '手动清除' }); continue }
        if (seen[x.bv] > keepPerBv) jobs.push({ file: x.f, n: x.n, bytes: x.bytes, kind: 'videos', why: keepPerBv === 0 ? '原片全清' : `同一 BV 的第 ${seen[x.bv]} 份` })
        else if (days > 0 && x.at < cutoff) jobs.push({ file: x.f, n: x.n, bytes: x.bytes, kind: 'videos', why: `超过 ${days} 天` })
      }
    } catch {}
  }

  // ② 打卡图：只按天数（默认 0 = 永不）
  if (want('albums')) {
    const a = { ...c.albums, ...(inherit.albums || {}) }
    const days = Math.max(0, Number(opt['days-albums'] ?? a.days ?? 0))
    if (all || days > 0) {
      const cutoff = Date.now() - days * 86400000
      try {
        for (const n of fs.readdirSync(P.album)) {
          const f = path.join(P.album, n)
          const st = fs.statSync(f)
          if (st.isFile() && (all || st.mtimeMs < cutoff)) jobs.push({ file: f, n, bytes: st.size, kind: 'albums', why: all ? '手动清除' : `超过 ${days} 天` })
        }
      } catch {}
    }
  }

  // ③ 缩略图：整个 tmp 都可以重建
  if (want('tmp')) {
    const tmp = { ...c.tmp, ...(inherit.tmp || {}) }
    const days = Math.max(0, Number(opt['days-tmp'] ?? tmp.days ?? 2))
    const cutoff = Date.now() - days * 86400000
    try {
      for (const n of fs.readdirSync(P.tmp)) {
        const f = path.join(P.tmp, n)
        const st = fs.statSync(f)
        if (all || days === 0 || st.mtimeMs < cutoff) jobs.push({ file: f, n, bytes: sizeOf(f), kind: 'tmp', why: all ? '手动清除' : (days === 0 ? '缩略图全清' : `超过 ${days} 天`) })
      }
    } catch {}
  }

  // ④ 顺手：空出来的帧、旧封面、字幕（跟着 videos 走）
  if (want('videos')) {
    const days = Math.max(0, Number(opt['days-videos'] ?? c.videos.days ?? 2))
    if (days > 0) {
      const cutoff = Date.now() - days * 86400000
      for (const [dir, kind] of [[P.frames, 'videos'], [path.join(DSH_HOME, 'shots', 'covers'), 'videos'], [P.subs, 'videos']]) {
        try {
          for (const n of fs.readdirSync(dir)) {
            const f = path.join(dir, n); const st = fs.statSync(f)
            if (st.isFile() && st.mtimeMs < cutoff) jobs.push({ file: f, n, bytes: st.size, kind, why: `附带文件超过 ${days} 天` })
          }
        } catch {}
      }
    }
  }
  void dirSize
  return jobs
}

/** 删掉打卡图之后，把账本里指向它的记录也摘掉（失败记录保留） */
function pruneAlbumLedger(goneFiles) {
  const gone = new Set(goneFiles.map((f) => path.basename(f)))
  const rows = albumList(100000)
  const keep = rows.filter((r) => {
    if (!r.out) return true                     // 失败记录没有图，留着
    return !gone.has(path.basename(r.out))
  })
  if (keep.length === rows.length) return 0
  const lines = keep.slice().reverse().map((r) => JSON.stringify(r)).join('\n') + '\n'
  fs.writeFileSync(P.albumIndex, lines, 'utf8')
  return rows.length - keep.length
}

function doClean(cfg, { only, dry, all = false, quiet = false, inherit = {} } = {}) {
  const jobs = planClean(cfg, { only, all, inherit })
  const total = jobs.reduce((s, j) => s + j.bytes, 0)
  let freed = 0
  const goneAlbums = []
  if (!dry) {
    for (const j of jobs) {
      try { fs.rmSync(j.file, { recursive: true, force: true }); freed += j.bytes; if (j.kind === 'albums') goneAlbums.push(j.file) } catch {}
    }
    if (goneAlbums.length) pruneAlbumLedger(goneAlbums)
  }
  if (quiet) { if (freed > 0) log(`[clean] 顺手清了 ${(freed / 1048576).toFixed(1)}MB`); return { freed, jobs } }
  const byKind = {}
  for (const j of jobs) byKind[j.kind] = (byKind[j.kind] ?? 0) + j.bytes
  return { jobs, total, freed, byKind }
}

// 出图成功后顺手清一次（每个类只有 auto=true 时才动）
function autoClean(cfg) {
  try {
    const c = cleanCfg(cfg)
    const only = CLEAN_KEYS.filter((k) => c[k]?.auto === true)
    if (!only.length) return
    doClean(cfg, { only, dry: false, quiet: true })
  } catch {}
}

function cmdClean() {
  const cfg = readConfig()
  const dry = has('dry')
  const only = opt.only ? String(opt.only).split(',').map((s) => s.trim()).filter(Boolean) : null
  if (only) {
    const bad = only.filter((k) => !CLEAN_KEYS.includes(k))
    if (bad.length) die({ error: '未知分类：' + bad.join(',') + '（可选 videos / albums / tmp）' })
  }
  const r = doClean(cfg, { only, dry, all: has('all') })
  out({
    ok: true, dry,
    only: only ?? CLEAN_KEYS,
    all: has('all'),
    files: r.jobs.length,
    mb: Number((r.total / 1048576).toFixed(1)),
    freedMB: dry ? 0 : Number((r.freed / 1048576).toFixed(1)),
    breakdown: Object.fromEntries(Object.entries(r.byKind).map(([k, v]) => [k, Number((v / 1048576).toFixed(1)) + 'MB'])),
    sample: r.jobs.slice(0, 12).map((j) => ({ name: j.n, kind: j.kind, mb: Number((j.bytes / 1048576).toFixed(1)), why: j.why })),
  })
}


// ── journal：旅游日记（她写的小作文）──────────────────────────────────────
//   每一步打卡对应一篇；正文是 Markdown，存在 <daka>/journal/<相册ID>.md。
async function cmdJournal() {
  const sub = opt._a ?? 'list'
  const cfg = readConfig()

  if (sub === 'list') {
    const done = listJournal()
    const doneIds = new Set(done.map((x) => x.id))
    const recs = albumList(100000).filter((r) => r.ok)
    out({
      ok: true,
      total: recs.length,
      written: recs.filter((r) => doneIds.has(r.id)).length,
      pending: recs.filter((r) => !doneIds.has(r.id)).map((r) => ({ id: r.id, bv: r.bv, t: r.t, date: String(r.at).slice(0, 10) })),
      persona: personaText(cfg).from,
      dir: journalPath('x').replace(/\\x\.md$/, ''),
    })
    return
  }

  if (sub === 'prompt') {
    const id = String(opt.id ?? '')
    const rec = albumList(100000).find((r) => r.id === id)
    if (!rec) die({ error: '相册里没有：' + id })
    process.stdout.write(buildJournalPrompt({
      id: rec.id, bv: rec.bv, t: rec.t, date: String(rec.at).slice(0, 10),
      line: rec.card?.line ?? '', action: rec.card?.action ?? '', why: rec.card?.why ?? '',
      score: rec.card?.score ?? null, title: rec.card?.title ?? '',
    }, cfg, FEIYU_CMD) + '\n')
    return
  }

  if (sub === 'write') {
    const id = String(opt.id ?? '')
    if (!id) die({ error: '需要 --id <相册ID>' })
    const rec = albumList(100000).find((r) => r.id === id)
    if (!rec) die({ error: '相册里没有：' + id })
    const facts = {
      id: rec.id, bv: rec.bv, t: rec.t, date: String(rec.at).slice(0, 10),
      line: rec.card?.line ?? '', action: rec.card?.action ?? '', why: rec.card?.why ?? '',
      score: rec.card?.score ?? null, title: rec.card?.title ?? '',
    }
    const prompt = buildJournalPrompt(facts, cfg, FEIYU_CMD)

    // ① 有人给正文（agent 写的 / 手写的）
    let text = ''
    if (opt.file) {
      const f = String(opt.file)
      if (!fs.existsSync(f)) die({ error: '文件不存在：' + f })
      text = fs.readFileSync(f, 'utf8')
    } else if (opt.text) {
      text = String(opt.text)
    } else if (!process.stdin.isTTY) {
      const piped = fs.readFileSync(0, 'utf8')
      if (piped.trim()) text = piped
    }

    // ② 没有正文 → 让 daka 自己调文本模型写
    if (!text.trim()) {
      const m = journalModel(cfg)
      if (has('dry') || !m.model) {
        out({ ok: !m.model ? false : true, dry: true, needModel: !m.model, prompt, ...(m.model ? {} : { error: '没有可用的文本模型（设置 → 旅游日记 → 文本模型），或者自己写完用 --file 传进来' }) })
        return
      }
      log('[journal] 用 ' + m.model + ' 写这篇…')
      const r = await chat({ endpoint: m.endpoint, model: m.model, apiKey: m.apiKey, prompt, temperature: m.temperature, maxTokens: Math.max(2000, Number(cfg.journal?.maxTokens ?? 2400)) })
      if (!r.ok) die({ error: '写作失败：' + (r.error || '') + (r.raw ? ' · ' + r.raw : '') })
      text = r.text
    }

    const saved = writeJournal(id, text)
    const min = Number(cfg.journal?.minChars ?? 500)
    if (saved.chars < min) log('[journal] ⚠ 只有 ' + saved.chars + ' 字，要求 ' + min + ' 字起步')
    out({ ok: true, ...saved, generated: !opt.file && !opt.text })
    return
  }

  if (sub === 'show') {
    const id = String(opt.id ?? '')
    const text = readJournal(id)
    if (!text) die({ error: '这篇还没写：' + id })
    process.stdout.write(text + '\n')
    return
  }

  die({ error: '用法: journal list | prompt --id <id> | write --id <id> [--file f.md|--text "…"] | show --id <id>' })
}

// ── push：只推视频，不产图 ────────────────────────────────────────────────
//   「这条没有我可以站的地方，但内容值得你看一眼」——就是走这条路。
//   纯文字私信 + 视频链接，不花生图额度、不占打卡额度。
function cmdPush() {
  const cfg = readConfig()
  const bv = String(opt.bv ?? opt._a ?? '').trim()
  if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) die({ error: '需要 --bv BV号（例如 BV1xxxxxxxxx）' })
  const note = String(opt.note ?? opt.msg ?? '').trim() || '这条我没打卡——没有能站进去的地方，但内容我觉得值得你看一眼。'
  const body = `${note}\nhttps://www.bilibili.com/video/${bv}/`.slice(0, 400)
  const dry = has('dry')
  const bili = findParentBili(cfg)
  if (!bili && !dry) die({ error: '找不到父插件的 bili.mjs（推送走它的私信通道）' })
  if (dry) { out({ ok: true, dry: true, bv, text: body, note: '未发送（父插件的 dm 才会真发）' }); return }
  const r = runParent(bili, ['dm', '--msg', body, '--go'], { timeoutMs: 300000 })
  out({ ok: r.ok, bv, text: body, code: r.code, stdout: r.stdout.slice(-600), stderr: r.stderr.slice(-400) })
  process.exit(r.ok ? 0 : 1)
}

// ── draft ─────────────────────────────────────────────────────────────────
function cmdDraft() {
  const sub = opt._a ?? 'list'
  const d = draftRead()
  if (sub === 'list') { out({ ok: true, items: d.items }); return }
  if (sub === 'drop') {
    const id = String(opt.id ?? '')
    d.items = d.items.filter((x) => x.id !== id)
    draftWrite(d)
    out({ ok: true, dropped: id, left: d.items.length })
    return
  }
  if (sub === 'show') {
    const hit = d.items.find((x) => x.id === String(opt.id ?? ''))
    if (!hit) die({ error: '没有这条草稿' })
    out({ ok: true, item: hit })
    return
  }
  die({ error: '用法: draft list | show --id x | drop --id x' })
}

// ── album ─────────────────────────────────────────────────────────────────
function cmdAlbum() {
  const n = Number(opt.n ?? 12)
  out({ ok: true, items: albumList(n) })
}

// ── rules ─────────────────────────────────────────────────────────────────
function cmdRules() {
  const sub = opt._a ?? 'status'
  if (sub === 'status') { out({ ok: true, ...rulesStatus(), command: FEIYU_CMD }); return }
  if (sub === 'attach') { out({ ok: true, ...rulesAttach(), command: FEIYU_CMD }); return }
  if (sub === 'detach') { out({ ok: true, ...rulesDetach() }); return }
  die({ error: '用法: rules status | attach | detach' })
}

// ── selftest ──────────────────────────────────────────────────────────────
function collectChecks() {
  ensureDirs()
  const cfg = readConfig()
  const secret = readSecret()
  const items = []
  const push = (name, ok, detail, fix) => items.push({ name, ok, detail, fix })
  const ff = ffmpegPath()
  push('ffmpeg', !!ff, ff ?? '没找到', 'winget install ffmpeg，或设 FFMPEG 环境变量')
  push('配置', true, P.config + (cfg.__hasUserFile ? '' : '（还没保存过，用的是默认值）'))
  push('API 密钥', secret.present, secret.present ? '已保存（不回显）' : '未保存', '设置 → 旅行肥鱼 → API 密钥')
  push('生图端点', !!cfg.api?.endpoint, cfg.api?.endpoint ?? '-', '填 https://…/v1')
  push('参考图', enabledRefs(cfg).length > 0, `可用 ${enabledRefs(cfg).length} 张`, '设置 → 旅行肥鱼 → 参考图 添加一张角色图')
  const p = parentState(cfg)
  push('父插件 bili.mjs', p.found, p.bili ?? '没找到（不影响生图，只影响发布）', '设置 → 旅行肥鱼 → 父插件路径')
  const rs = rulesStatus()
  push('AGENTS.md 守则', rs.attached, rs.attached ? `${rs.version}${rs.stale ? '（路径过期，建议重新接入）' : ''}` : '未接入', '设置 → 旅行肥鱼 → 接入父插件')
  let shots = 0
  try { shots = fs.readdirSync(P.shots).filter((n) => n.toLowerCase().endsWith('.mp4')).length } catch {}
  push('本机视频素材', shots > 0, `${shots} 个 mp4 在 ${P.shots}`, '父插件深读视频时会下载原片')
  // 新增：装没装进 profile（bundle 层）
  let wired = []
  try {
    const profRoot = path.join(DSH_HOME, 'profiles')
    for (const name of fs.readdirSync(profRoot)) {
      const f = path.join(profRoot, name, 'package.json')
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'))
        if ((j.dsh?.profile?.bundles ?? []).includes('dsh-bili-lvxingfeiyu')) wired.push(name)
      } catch {}
    }
  } catch {}
  push('装进 profile', wired.length > 0, wired.length ? wired.join(', ') : '没有 profile 的 bundles 里包含 dsh-bili-lvxingfeiyu', 'node tools/install.mjs，然后完全退出 DSH 再打开')

  // 新增：数据目录可写
  let writable = false
  try { const probe = path.join(ROOT, '.write-probe'); fs.writeFileSync(probe, 'ok'); fs.rmSync(probe); writable = true } catch {}
  push('数据目录可写', writable, ROOT, '检查目录权限：' + ROOT)

  return { items, cfg, secret }
}

async function cmdSelftest() {
  const { items } = collectChecks()
  const ok = items.every((i) => i.ok)
  out({ ok, items, paths: { root: ROOT, config: P.config, album: P.album, refs: P.refs } })
}

// 给人看的体检：一行一项，失败的直接给出下一步
function cmdDoctor() {
  const { items } = collectChecks()
  const bad = items.filter((i) => !i.ok)
  process.stdout.write('\n旅行肥鱼 v1.0.0 体检\n' + '─'.repeat(52) + '\n')
  for (const i of items) {
    const mark = i.ok ? '✔' : '✘'
    process.stdout.write(mark + ' ' + i.name.padEnd(14, ' ') + ' ' + String(i.detail ?? '').slice(0, 60) + '\n')
    if (!i.ok && i.fix) process.stdout.write('    → ' + i.fix + '\n')
  }
  process.stdout.write('─'.repeat(52) + '\n')
  if (!bad.length) process.stdout.write('全部通过。可以让她跑一轮了。\n\n')
  else process.stdout.write(`${bad.length} 项没过，先解决上面带 → 的。\n\n`)
}

// ── 分发 ──────────────────────────────────────────────────────────────────
const USAGE = `dsh-bili-lvxingfeiyu <命令>

  status                       看额度 / 密钥 / 参考图 / 父插件 / 守则
  models                       拉取该端点可用的模型列表
  refs list|add|rm|note|toggle 参考图（图 + 注释）
  pick <BV> [--around mm:ss]   从本机视频里找候选帧（零网络）
  fetch <BV> [--qn 80] [--force]   自己把原片下到本机（+ 尝试抓字幕）
  frame <BV> --at mm:ss        取一张原分辨率帧
  render --bv BV --at mm:ss --card card.json [--dry]
  render --draft <id> [--force] 从队列里生成
  draft list|show|drop         待打卡队列
  album [--n 12]               相册
  publish --id <相册ID> [--dry]  按设置发布到 动态/评论/私信/私信带图/桌面
  clean [--dry] [--all] [--only videos,albums,tmp]   清原片/帧/缩略图（tmp 默认全清）
  push --bv <BV> [--note "…"] [--dry]   只推视频链接、不产图（"值得看但没必要打卡"）
  dm-image --image <png> --msg "附言" [--dry|--go]   直接私信发一张图
  rules status|attach|detach   接入 / 摘掉 AGENTS.md 守则
  selftest                     体检（JSON）
  doctor                       体检（人看的，带修复建议）
`

async function main() {
  ensureDirs()
  switch (cmd) {
    case 'status': cmdStatus(); break
    case 'secret': cmdSecret(); break
    case 'models': await cmdModels(); break
    case 'refs': cmdRefs(); break
    case 'pick': await cmdPick(); break
    case 'frame': await cmdFrame(); break
    case 'fetch': await cmdFetch(); break
    case 'render': await cmdRender(); break
    case 'publish': cmdPublish(); break
    case 'push': cmdPush(); break
    case 'clean': cmdClean(); break
    case 'journal': await cmdJournal(); break
    case 'dm-image': {
      // 私信发图：直接转发给 tools/commands/dm-image.mjs（stdio 继承，人读的输出原样出）
      const script = path.join(PLUGIN_ROOT, 'tools', 'commands', 'dm-image.mjs')
      if (!fs.existsSync(script)) { out({ ok: false, error: '找不到 tools/commands/dm-image.mjs' }); process.exit(1) }
      try {
        execFileSync(process.execPath, [script, ...argv.slice(1)], { stdio: 'inherit', timeout: 300000 })
        process.exit(0)
      } catch (e) { process.exit(e.status ?? 1) }
      break
    }
    case 'draft': cmdDraft(); break
    case 'album': cmdAlbum(); break
    case 'rules': cmdRules(); break
    case 'selftest': await cmdSelftest(); break
    case 'doctor': cmdDoctor(); break
    case 'config': {
      const cfg = readConfig()
      const sub = opt._a
      if (!sub || sub === 'show') { const { __hasUserFile, ...rest } = cfg; out({ ok: true, config: rest, hasUserFile: __hasUserFile }); break }
      if (sub === 'set') {
        const dotted = String(opt.key ?? '').trim()
        if (!dotted) die({ error: '用法: config set --key api.endpoint --value https://…' })
        const raw = opt.value === undefined ? '' : String(opt.value)
        let value = raw
        if (/^(true|false)$/i.test(raw)) value = raw.toLowerCase() === 'true'
        else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw)
        else if (/^[\[{]/.test(raw)) {
          try { value = JSON.parse(raw) } catch {
            // PowerShell 会把 " 吃掉（'["a","b"]' → [a,b]）→ 退化成逗号列表
            if (/^\[.*\]$/.test(raw)) value = raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
            else die({ error: '看起来像 JSON 但解析失败：' + raw })
          }
        }
        const user = readJson(P.config, {}) || {}
        let cur = user
        const keys = dotted.split('.')
        for (let i = 0; i < keys.length - 1; i += 1) {
          const k = keys[i]
          if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
          cur = cur[k]
        }
        cur[keys[keys.length - 1]] = value
        writeConfig(user)
        out({ ok: true, set: dotted, value })
        break
      }
      die({ error: '用法: config show | config set --key a.b --value v' })
    }
    default:
      if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { process.stdout.write(USAGE); break }
      process.stderr.write('未知命令: ' + cmd + '\n\n' + USAGE); process.exit(2)
  }
}

main().catch((e) => { out({ ok: false, error: String(e?.message ?? e), stack: String(e?.stack ?? '').split('\n').slice(0, 4) }); process.exit(1) })
