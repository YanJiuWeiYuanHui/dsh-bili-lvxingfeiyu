/**
 * dsh-bili-lvxingfeiyu —— 宿主侧插件（设置壳）
 *
 * 职责三件：
 *   1. 设置页：DSH 客户端 section「打卡」（lib/client.js）
 *   2. 配置/密钥/参考图/守则：GET/POST /dsh-bili-lvxingfeiyu/api/*（纯 fs，不依赖 node 运行时）
 *   3. 慢操作（拉模型 / 生成 / 发布 / 体检）：spawn `tools/feiyu.mjs`，把 JSON 原样带回
 *
 * 它**不连 B 站**，只读父插件已经下到本地的素材；发布才调用父插件的命令。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { resolveRuntime } from './node-runtime.js'
import { findParentBili } from '../tools/lib/parent.mjs'
import { readJournal, writeJournal, buildJournalPrompt, personaText, JOURNAL_DIR, OWN_PERSONA } from '../tools/lib/journal.mjs'
import { detectPlugins } from '../tools/lib/rules.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FEIYU_CLI = path.join(HERE, '..', 'tools', 'feiyu.mjs')

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
const ROOT = path.join(DSH_HOME, 'lvxingfeiyu')
const P = {
  config: path.join(DSH_HOME, 'lvxingfeiyu.config.json'),
  secret: path.join(ROOT, 'secret.json'),
  refs: path.join(ROOT, 'refs'),
  refsIndex: path.join(ROOT, 'refs', 'refs.json'),
  album: path.join(ROOT, 'album'),
  albumIndex: path.join(ROOT, 'album.jsonl'),
  queue: path.join(ROOT, 'draft.json'),
  agents: path.join(DSH_HOME, 'AGENTS.md'),
}

const DEFAULTS = {
  enabled: true, mode: 'manual', daily: 1, perVideo: 1,
  api: { endpoint: 'https://api.openai.com/v1', model: 'gpt-image-2', size: 'follow', extraHeaders: {}, timeoutMs: 180000 },
  candidates: { segments: 3, burst: 7, windowSec: 6 },
  character: { note: '' },
  prompt: { suffix: '', negative: '多余的手臂、多余的手指、六根手指、第三条腿、双头、头部与胸部融合、身体部位粘连、重复肢体、断肢、比例失调、五官错位、背景被重绘、其他人物、文字、水印、马赛克、尾巴断裂、尾巴与身体分离、多条尾巴、尾鳍缺失、尾巴被画面裁切、尾巴像平贴的图案、肢体被裁切、人物被画框切边、把设定图的多个视角拼在一起' },
  publish: { mode: 'manual', dest: ['album'], textTemplate: '#她在打卡# {line}\n来自 {bv} 的 {time}', minScore: 13, comment: { reason: '她在视频里找到了一个值得站进去的地方' } },
  parent: { bili: '' },
}

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || '.'
const deepMerge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] ?? {}, v) : v
  }
  return out
}
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const atomic = (f, obj) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.${crypto.randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n'); fs.renameSync(tmp, f) } finally { try { fs.rmSync(tmp, { force: true }) } catch {} }
}
const readConfig = () => ({ ...deepMerge(DEFAULTS, readJson(P.config, {}) || {}), __hasUserFile: !!readJson(P.config) })
const writeConfig = (next) => { const c = { ...next }; delete c.__hasUserFile; atomic(P.config, c); return c }
const readSecret = () => ({ present: !!String((readJson(P.secret, {}) || {}).apiKey ?? '').trim() })
const readRefs = () => { const j = readJson(P.refsIndex, { items: [] }) || { items: [] }; return Array.isArray(j.items) ? j.items : [] }
const writeRefs = (items) => atomic(P.refsIndex, { items })
const readQueue = () => { const j = readJson(P.queue, { items: [] }) || { items: [] }; return Array.isArray(j.items) ? j.items : [] }
const writeQueue = (items) => atomic(P.queue, { items })
const albumList = (n = 20) => {
  let lines = []
  try { lines = fs.readFileSync(P.albumIndex, 'utf8').split(/\r?\n/).filter(Boolean) } catch {}
  return lines.slice(-n).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse()
}


/** 把投递错误翻译成人话（abort = 超时） */
function promptError(e) {
  const aborted = e?.name === 'AbortError' || /abort/i.test(msg)
  return aborted ? '投递超时：宿主没在 10 秒内接收（会话可能还没起来），过一会儿再试' : msg.slice(0, 200)
}

const DBG = (m) => { try { console.log(m) } catch {} }
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}
function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); return } chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// 子进程里跑 CLI；stdout 是 JSON，原样解析后转回
function runCli(args, { timeout = 240000 } = {}) {
  return new Promise((resolve) => {
    let rt
    try { rt = resolveRuntime(DSH_HOME) } catch (e) { resolve({ ok: false, error: String(e.message) }); return }
    execFile(rt.file, [FEIYU_CLI, ...args], {
      timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
      env: { ...rt.env, DSH_HOME, USERPROFILE: HOME_DIR },
    }, (err, stdout, stderr) => {
      const text = String(stdout ?? '').trim()
      try { resolve(JSON.parse(text)) } catch {
        resolve({ ok: false, error: String(stderr || err?.message || 'CLI 没有返回 JSON').slice(0, 600), stdout: text.slice(0, 600) })
      }
    })
  })
}

export default {
  name: 'dsh-bili-lvxingfeiyu',
  inject: ['webServer'],
  apply(ctx) {
    const disposers = []
    const isLoopback = (req) => {
      const host = String(req.headers?.host ?? '').toLowerCase()
      const h = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
      return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
    }
    // 安全组件的默认值必须是"关"：栅栏不可用就拒绝
    function rejected(req, res) {
      if (isLoopback(req)) {
        try {
          const conn = ctx.get?.('connection') || ctx.connection
          if (conn && typeof conn.requestRejection === 'function') {
            const code = conn.requestRejection(req)
            if (code !== undefined && code !== null && code !== false) { res.statusCode = typeof code === 'number' ? code : 403; res.end(); return true }
          }
        } catch { json(res, 503, { ok: false, error: '信任栅栏异常，拒绝访问' }); return true }
        return false
      }
      try {
        const conn = ctx.get?.('connection') || ctx.connection
        if (conn && typeof conn.isTrusted === 'function' && conn.isTrusted(req) === true) {
          if (typeof conn.requestRejection === 'function') {
            const code = conn.requestRejection(req)
            if (code !== undefined && code !== null && code !== false) { res.statusCode = typeof code === 'number' ? code : 403; res.end(); return true }
          }
          return false
        }
      } catch {}
      json(res, 403, { ok: false, error: '不受信任的访问来源' })
      return true
    }
    function route(kind, pathname, handler) {
      disposers.push(ctx.webServer.register({
        kind, path: pathname,
        handler: async (req, res) => {
          if (rejected(req, res)) return
          try { await handler(req, res) } catch (e) { try { json(res, 500, { ok: false, error: String(e?.message ?? e) }) } catch {} }
        },
      }))
    }

    // ── 总状态 ────────────────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/state', async (req, res) => {
      const cfg = readConfig()
      const q = readJson(path.join(ROOT, 'quota.json'), {}) || {}
      const today = new Date().toLocaleDateString('sv-SE')
      const used = q.date === today ? Number(q.count ?? 0) : 0
      let rules = { attached: false }
      try {
        const t = fs.readFileSync(P.agents, 'utf8')
        rules = { attached: /<!-- lvxingfeiyu:begin/.test(t), version: (/lvxingfeiyu:begin\s+(v\d+)/.exec(t) ?? [])[1] ?? null }
      } catch {}
      try {
        rules.plugins = detectPlugins()
      } catch {}
      json(res, 200, {
        ok: true,
        config: cfg,
        secret: readSecret(),
        refs: readRefs(),
        queue: readQueue(),
        album: albumList(12),
        rules,
        pilgrim: readPilgrim().slice(-6).reverse(),
        today: { date: today, used, remaining: Math.max(0, Number(cfg.daily ?? 1) - used) },
        paths: { root: ROOT, config: P.config, album: P.album, refs: P.refs, agents: P.agents },
      })
    })

    // ── 配置 ──────────────────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/config', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse(await readBody(req) || '{}')
      const incoming = body?.config ?? body ?? {}
      const KNOWN = new Set(['enabled', 'mode', 'daily', 'perVideo', 'api', 'candidates', 'character', 'prompt', 'publish', 'parent', 'clean', 'journal'])
      const filtered = {}
      for (const [k, v] of Object.entries(incoming)) if (KNOWN.has(k)) filtered[k] = v
      const cur = readConfig()
      delete cur.__hasUserFile
      const next = deepMerge(cur, filtered)
      if (!['manual', 'auto'].includes(next.mode)) next.mode = 'manual'
      next.daily = Math.min(10, Math.max(0, Number(next.daily) || 0))
      next.perVideo = Math.min(5, Math.max(1, Number(next.perVideo) || 1))
      if (!next.api?.endpoint || !/^https?:\/\//.test(String(next.api.endpoint))) { json(res, 400, { ok: false, error: 'API 端点必须是 http(s) 地址' }); return }
      if (!next.api?.model) { json(res, 400, { ok: false, error: '必须选一个模型' }); return }
      const pm = ['manual', 'auto', 'auto-if-good']
      if (!pm.includes(next.publish?.mode)) next.publish.mode = 'manual'
      const allowed = ['album', 'dynamic', 'comment', 'dm', 'dm-image', 'desktop']
      next.publish.dest = (Array.isArray(next.publish?.dest) ? next.publish.dest : ['album']).filter((d) => allowed.includes(d))
      if (!next.publish.dest.length) next.publish.dest = ['album']
      writeConfig(next)
      json(res, 200, { ok: true, config: next })
    })

    // ── 密钥（只写，永不回显） ────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/secret', async (req, res) => {
      if (req.method === 'GET') { json(res, 200, { ok: true, ...readSecret() }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse(await readBody(req) || '{}')
      const key = String(body.apiKey ?? '').trim()
      if (key.length < 8) { json(res, 400, { ok: false, error: '密钥太短' }); return }
      atomic(P.secret, { apiKey: key })
      try {
        if (process.platform !== 'win32') fs.chmodSync(P.secret, 0o600)
        else {
          const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
          const opts = { encoding: 'utf8', windowsHide: true, timeout: 8000 }
          const sid = execFileSyncSafe(path.join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], opts)?.match(/S-1-\d+(?:-\d+)+/)?.[0]
          if (sid) execFileSyncSafe(path.join(system, 'icacls.exe'), [P.secret, '/inheritance:r', '/grant:r', `*${sid}:(F)`, '/Q'], opts)
        }
      } catch {}
      json(res, 200, { ok: true, present: true })
    })

    // ── 模型列表 ──────────────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/models', async (req, res) => {
      const r = await runCli(['models'], { timeout: 60000 })
      json(res, 200, r)
    })

    // ── 参考图 ────────────────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/refs', async (req, res) => {
      if (req.method === 'GET') { json(res, 200, { ok: true, items: readRefs() }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const op = String(b.op ?? '')
      const items = readRefs()

      if (op === 'upload') {
        const dataUrl = String(b.dataUrl ?? '')
        const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i.exec(dataUrl)
        if (!m) { json(res, 400, { ok: false, error: '只收 png/jpg/webp/gif 的 dataURL' }); return }
        const ext = m[1].toLowerCase().replace('jpeg', 'jpg')
        const name = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}.${ext}`
        fs.mkdirSync(P.refs, { recursive: true })
        fs.writeFileSync(path.join(P.refs, name), Buffer.from(m[2], 'base64'))
        items.push({ file: name, note: String(b.note ?? '').slice(0, 120) || name, enabled: true, addedAt: new Date().toISOString() })
        writeRefs(items)
        json(res, 200, { ok: true, items })
        return
      }
      if (op === 'note') {
        const hit = items.find((x) => x.file === b.file)
        if (!hit) { json(res, 404, { ok: false, error: '没有这张图' }); return }
        hit.note = String(b.note ?? '').slice(0, 200)
        writeRefs(items); json(res, 200, { ok: true, items }); return
      }
      if (op === 'toggle') {
        const hit = items.find((x) => x.file === b.file)
        if (!hit) { json(res, 404, { ok: false, error: '没有这张图' }); return }
        hit.enabled = hit.enabled === false
        writeRefs(items); json(res, 200, { ok: true, items }); return
      }
      if (op === 'remove') {
        const left = items.filter((x) => x.file !== b.file)
        writeRefs(left)
        try { fs.rmSync(path.join(P.refs, String(b.file)), { force: true }) } catch {}
        json(res, 200, { ok: true, items: left }); return
      }
      json(res, 400, { ok: false, error: '未知操作：' + op })
    })

    // ── 守则：接入 / 卸载 ─────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/rules', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const action = String(b.action ?? 'status')
      const r = await runCli(['rules', action], { timeout: 30000 })
      json(res, 200, r)
    })

    // ── 待打卡队列 ────────────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/queue', async (req, res) => {
      if (req.method === 'GET') { json(res, 200, { ok: true, items: readQueue() }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      if (b.action === 'drop') {
        writeQueue(readQueue().filter((x) => x.id !== id))
        json(res, 200, { ok: true, items: readQueue() }); return
      }
      if (b.action === 'render') {
        const r = await runCli(['render', '--draft', id], { timeout: 300000 })
        json(res, 200, { ...r, items: readQueue() }); return
      }
      json(res, 400, { ok: false, error: '未知操作' })
    })

    // ── 相册 ──────────────────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/album', async (req, res) => {
      const n = Number(new URL(req.url, 'http://x').searchParams.get('n') ?? 24)
      json(res, 200, { ok: true, items: albumList(Number.isFinite(n) ? n : 24) })
    })

    // ── 旅游日记：按天分篇 ────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/diary', async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams
      const days = Math.min(365, Math.max(1, Number(q.get('days') ?? 60)))
      const since = Date.now() - days * 86400000
      const byDay = new Map()
      for (const rec of albumList(100000)) {
        const t = Date.parse(rec.at ?? '')
        if (!Number.isFinite(t) || t < since || !rec.ok) continue
        const day = new Date(t).toLocaleDateString('sv-SE')
        if (!byDay.has(day)) byDay.set(day, [])
        byDay.get(day).push({
          id: rec.id, bv: rec.bv, t: rec.t, out: rec.out,
          why: rec.card?.why ?? '', action: rec.card?.action ?? '',
          line: rec.card?.line ?? '', score: rec.card?.score ?? null,
          size: rec.sizeActual ?? rec.sizeRequested ?? '', model: rec.model ?? '',
          journal: readJournal(rec.id),   // 她写的小作文（没有就是空串）
          at: rec.at,
        })
      }
      const out = [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([date, entries]) => ({
          date,
          weekday: ['日', '一', '二', '三', '四', '五', '六'][new Date(date + 'T00:00:00').getDay()],
          entries: entries.sort((x, y) => String(x.at).localeCompare(String(y.at))),
        }))
      json(res, 200, { ok: true, days: out, total: out.reduce((n, d) => n + d.entries.length, 0) })
    })

    // ── 人设：只装旅行肥鱼的人在这里写；装了 whale 会自动共用它的 persona.md ──
    route('exact', '/dsh-bili-lvxingfeiyu/api/persona', async (req, res) => {
      if (req.method === 'GET') {
        const p = personaText(readConfig())
        json(res, 200, { ok: true, text: p.text, from: p.from, source: p.source, own: OWN_PERSONA })
        return
      }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const text = String(b.text ?? '').trim()
      try {
        fs.mkdirSync(ROOT, { recursive: true })
        if (!text) { try { fs.rmSync(OWN_PERSONA, { force: true }) } catch {} }
        else fs.writeFileSync(OWN_PERSONA, text.slice(0, 20000) + '\n', 'utf8')
        const p = personaText(readConfig())
        json(res, 200, { ok: true, chars: text.length, from: p.from, source: p.source })
      } catch (e) { json(res, 200, { ok: false, error: String(e?.message ?? e) }) }
    })

    // ── 清理：一键清除 / 打开文件夹 ────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/clean', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const only = Array.isArray(b.only) && b.only.length ? b.only.filter((k) => ['videos', 'albums', 'tmp'].includes(k)) : null
      const args = ['clean']
      if (only) args.push('--only', only.join(','))
      if (b.all) args.push('--all')
      if (b.dry) args.push('--dry')
      const r = await runCli(args, { timeout: 120000 })
      json(res, 200, r)
    })

    // ── 用 DSH 自己写小作文（不需要外部文本模型）────────────────────────
    //   旅行肥鱼建一个自己的会话（cwd = 数据目录，sandbox 也写得进去），
    //   把「人设 + 这次的事实 + 写法要求」交给它，它写完自己调 journal write 存盘。
    const JOURNAL_SESSION = 'daka-journal'
    const JOURNAL_SENT = path.join(ROOT, 'journal-auto.json')
    const sentState = () => { const j = readJson(JOURNAL_SENT, {}) || {}; return j && typeof j === 'object' ? j : {} }
    const markSent = (id) => { const s = sentState(); s[id] = new Date().toISOString(); atomic(JOURNAL_SENT, s) }

    /** 投递一篇（同一个 id 只会投一次） */
    async function kickJournal(id) {
      if (readJournal(id)) return { ok: true, already: true, reason: '这篇已经写过了' }
      if (sentState()[id]) return { ok: false, already: true, reason: '已经投过一次，等她写完' }
      const rec = albumList(100000).find((r) => r.id === id)
      if (!rec) return { ok: false, reason: '相册里没有：' + id }

      const prompt = buildJournalPrompt({
        id: rec.id, bv: rec.bv, t: rec.t, date: String(rec.at).slice(0, 10),
        line: rec.card?.line ?? '', action: rec.card?.action ?? '', why: rec.card?.why ?? '',
        score: rec.card?.score ?? null, title: rec.card?.title ?? '',
      }, readConfig(), FEIYU_CLI)

      const text = [
        '【给 daka 写一篇旅游日记】',
        prompt,
        '',
        '---',
        '存盘：把正文写到文件再传进去 ——',
        `  node "${FEIYU_CLI}" journal write --id ${id} --file <你写的.md>`,
        '写完只回一句"已写 N 字"，不要复述正文。',
      ].join('\n')

      const cwd = ROOT
      try { fs.mkdirSync(cwd, { recursive: true }) } catch {}
      try {
        const sc = (ctx.get?.('sessionController')) || ctx.sessionController
        if (!sc || typeof sc.prompt !== 'function') return { ok: false, reason: '拿不到 sessionController' }
        try { await sc.create({ sessionId: JOURNAL_SESSION, cwd }) } catch { /* 已存在就继续 */ }
        // DSH 的 prompt 需要第二个参数 AbortSignal（父插件就是这么调的）
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), 10000)
        try {
          await sc.prompt({
            requestId: 'daka-journal-' + id + '-' + Date.now(),
            sessionId: JOURNAL_SESSION, mode: 'queue',
            content: [{ type: 'text', text }],
            signal: ac.signal,
          }, ac.signal)
        } finally { clearTimeout(timer) }
        markSent(id)
        return { ok: true, delivered: true, reason: '已交给 DSH 写' }
      } catch (e) {
        return { ok: false, reason: promptError(e) }
      }
    }

    // 手动触发（界面上的「让 DSH 写」用这条）
    route('exact', '/dsh-bili-lvxingfeiyu/api/journal/auto', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
      const r = await kickJournal(id)
      json(res, 200, { ...r, id, session: JOURNAL_SESSION })
    })

    // 兜底：每 60 秒看一眼，有没有"打了卡但还没写"的（每次只投一篇，避免堆消息）
    let journalTimer = null
    try {
    journalTimer = setInterval(async () => {
      try {
        if (readConfig().journal?.auto === false) return
        const pending = albumList(50).filter((r) => r.ok && !readJournal(r.id) && !sentState()[r.id])
        if (!pending.length) return
        const target = pending[pending.length - 1]   // 最早那篇先写
        const r = await kickJournal(target.id)
        if (r.delivered) DBG('[daka] 自动写作已投递：' + target.id)
      } catch {}
    }, 60_000)
    if (journalTimer && typeof journalTimer.unref === 'function') journalTimer.unref()
    disposers.push(() => { if (journalTimer) clearInterval(journalTimer) })
    } catch (e) { try { console.warn('[旅行肥鱼] 日记定时器没起来（不影响其它功能）：' + e.message) } catch {} }

    // 打开某个数据目录（资源管理器），方便手动删
    route('exact', '/dsh-bili-lvxingfeiyu/api/open', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const map = {
        videos: path.join(DSH_HOME, 'shots', 'video'),
        albums: P.album,
        tmp: path.join(ROOT, 'tmp'),
        refs: P.refs,
        frames: path.join(ROOT, 'frames'),
        root: ROOT,
      }
      const dir = map[String(b.target ?? '')]
      if (!dir) { json(res, 400, { ok: false, error: '未知目录：' + b.target }); return }
      try { fs.mkdirSync(dir, { recursive: true }) } catch {}
      // 跨平台：Windows / macOS / Linux 各用自己的打开方式；detached + unref，不拖住宿主
      const opener = process.platform === 'win32' ? 'explorer.exe'
        : process.platform === 'darwin' ? 'open' : 'xdg-open'
      try {
        const child = spawn(opener, [dir], { detached: true, stdio: 'ignore', windowsHide: false })
        child.on('error', () => {})
        child.unref()
        json(res, 200, { ok: true, dir, opener })
      } catch (e) { json(res, 200, { ok: false, dir, error: String(e?.message ?? e) }) }
    })


    // ── 赛博旅游：丢一个视频地址进去，让她自己去看、自己判断值不值得打卡 ──
    //   这里**不下载、不抽帧、不判断**——只把请求转交给她那个会话。
    //   看视频是父插件的事，判断是模型的事，我们只负责把门打开。
    const PILGRIM = path.join(ROOT, 'pilgrim.json')
    const readPilgrim = () => { const j = readJson(PILGRIM, { items: [] }) || { items: [] }; return Array.isArray(j.items) ? j.items : [] }
    const writePilgrim = (items) => atomic(PILGRIM, { items })

    function parseBv(input) {
      const s = String(input ?? '').trim()
      const direct = /^(BV[0-9A-Za-z]{10})$/.exec(s)
      if (direct) return direct[1]
      const inUrl = /\/video\/(BV[0-9A-Za-z]{10})/i.exec(s)
      if (inUrl) return inUrl[1]
      const loose = /\b(BV[0-9A-Za-z]{10})\b/.exec(s)
      if (loose) return loose[1]
      return null
    }

    route('exact', '/dsh-bili-lvxingfeiyu/api/pilgrimage', async (req, res) => {
      if (req.method === 'GET') { json(res, 200, { ok: true, items: readPilgrim().slice(-20).reverse() }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const raw = String(b.url ?? '').trim()
      if (!raw) { json(res, 400, { ok: false, error: '给一个视频地址或 BV 号' }); return }
      if (/b23\.tv|bili2233\.cn/i.test(raw)) {
        json(res, 400, { ok: false, error: '短链要先展开：在浏览器里打开它，把地址栏里的完整 /video/BV… 地址粘过来' })
        return
      }
      const bv = parseBv(raw)
      if (!bv) { json(res, 400, { ok: false, error: '认不出 BV 号。支持 https://www.bilibili.com/video/BV… 或直接贴 BV 号' }); return }

      const requestId = 'daka-pilgrim-' + Date.now()
      const item = { id: requestId, bv, url: raw, at: new Date().toISOString(), status: 'queued', note: '' }

      // 用绝对路径，别指望她的 cwd 里正好有 bili.mjs
      const parentBili = findParentBili(readConfig()) || 'bili.mjs'

      // 交给她：这条 prompt 自带完整流程，不依赖她记住守则
      const text = [
        '【赛博旅游 · 主人指定的视频】',
        `主人给了这条视频：https://www.bilibili.com/video/${bv}/ （${bv}）`,
        '',
        '请按下面的顺序做，不要跳过：',
        `1) 先看额度：\`node "${FEIYU_CLI}" status --json\` —— remaining 为 0 就说明原因，别硬来`,
        `2) 看懂它：\`node "${parentBili}" debrief ${bv}\`（会下载原片 + 抽帧 + 字幕 + 弹幕热区）`,
        `3) 找地方：\`node "${FEIYU_CLI}" pick ${bv}\` —— 拿候选段、缩略图、那一刻的字幕`,
        '4) 判：严格按 prompts/rubric.md。没有适合你站进去的地方就如实说"这条不值得打卡"，**不要凑数**。',
        '5) 判为可以 → 写判定卡（必须填 action 和 line）→',
        `   \`node "${FEIYU_CLI}" render --bv ${bv} --at <mm:ss> --card <card.json>\``,
        '6) 处理完把结论告诉主人：值不值得、挑的是哪一刻、为什么。',
        '',
        '注意：这是主人主动要的，不受"今天没有值得打卡的地方"那条约束；但**仍然不许为了交差硬挑**。',
      ].join('\n')

      let delivered = false
      let reason = ''
      try {
        const sc = (ctx.get?.('sessionController')) || ctx.sessionController
        if (!sc || typeof sc.prompt !== 'function') {
          reason = '拿不到 sessionController（这条已写进队列，等她下次醒来处理）'
        } else {
          // ⚠️ 这个 prompt 有可能一直不 resolve（她的会话没在跑时）。
          //   给 10 秒上限，否则设置页那个按钮会一直转圈。
          const ac = new AbortController()
          const timer = setTimeout(() => ac.abort(), 10000)
          try {
            await sc.prompt({ requestId, sessionId: 'bili-whale', mode: 'queue', content: [{ type: 'text', text }], signal: ac.signal }, ac.signal)
          } finally { clearTimeout(timer) }
          delivered = true
          reason = '已投递到她的会话'
        }
      } catch (e) {
        reason = '投递失败：' + promptError(e)
      }

      item.status = delivered ? 'sent' : 'queued'
      item.note = reason
      const items = readPilgrim()
      items.push(item)
      writePilgrim(items.slice(-50))
      json(res, 200, { ok: true, bv, id: requestId, delivered, reason, text: delivered ? undefined : text })
    })
    // 图片本体（只看相册/参考图/帧，不暴露任意路径）
    // ⚠️ prefix 路由的 path **不能带尾斜杠**：DSH 的匹配是
    //     pathname === prefix || pathname.startsWith(prefix + '/')
    //   带尾斜杠会拼出 '//' 去比 → 永远 404（这里踩过一次）。
    const FILE_PREFIX = '/dsh-bili-lvxingfeiyu/api/file'
    route('prefix', FILE_PREFIX, async (req, res) => {
      const rel = decodeURIComponent(String(req.url).split(FILE_PREFIX + '/')[1] ?? '').split('?')[0]
      const [kind, ...rest] = rel.split('/')
      const name = path.basename(rest.join('/'))
      const dir = kind === 'album' ? P.album : kind === 'refs' ? P.refs : kind === 'frames' ? path.join(ROOT, 'frames') : null
      if (!dir || !name) { json(res, 404, { ok: false }); return }
      const f = path.join(dir, name)
      if (!fs.existsSync(f)) { json(res, 404, { ok: false, error: '找不到：' + name }); return }
      const ext = path.extname(f).toLowerCase()
      const mime = ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif' : 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': fs.statSync(f).size, 'Cache-Control': 'no-store' })
      fs.createReadStream(f).pipe(res)
    })

    // ── 发布 / 体检 ───────────────────────────────────────────────────
    route('exact', '/dsh-bili-lvxingfeiyu/api/publish', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const args = ['publish', '--id', String(b.id ?? '')]
      if (b.text) args.push('--text', String(b.text))
      if (b.dry) args.push('--dry')
      const r = await runCli(args, { timeout: 360000 })
      json(res, 200, r)
    })
    route('exact', '/dsh-bili-lvxingfeiyu/api/selftest', async (req, res) => {
      const r = await runCli(['selftest'], { timeout: 60000 })
      json(res, 200, r)
    })

    ctx.effect(() => () => { for (const d of disposers) { try { d() } catch {} } })
    try { console.log('[旅行肥鱼] 设置页已挂载：/dsh-bili-lvxingfeiyu/ · 数据目录 ' + ROOT) } catch {}
  },
}

// 小工具：execFileSync 的容错封装（icacls/whoami 失败不该炸掉请求）
function execFileSyncSafe(file, args, opts) {
  try { return fsSyncExec(file, args, opts) } catch { return '' }
}
import { execFileSync as fsSyncExec } from 'node:child_process'
