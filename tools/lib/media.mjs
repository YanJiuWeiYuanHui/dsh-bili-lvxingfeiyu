// 本机媒体处理：只读父插件已经下到本地的 mp4 / 字幕，**不产生任何网络请求**。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { P, readConfig } from './core.mjs'

const isWin = process.platform === 'win32'
const exists = (f) => { try { return fs.statSync(f).isFile() } catch { return false } }

function onPath(names) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); if (exists(f)) return f }
  return null
}

/** 本机便利：剪映自带的 ffmpeg/ffprobe（不可再分发，只在本机用）。 */
function jianying(names) {
  if (!isWin) return null
  const base = path.join(process.env.LOCALAPPDATA || '', 'JianyingPro', 'Apps')
  try {
    for (const v of fs.readdirSync(base)) for (const n of names) {
      const f = path.join(base, v, n)
      if (exists(f)) return f
    }
  } catch {}
  return null
}

const ffNames = isWin ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg']
const probeNames = isWin ? ['ffprobe.exe', 'ffprobe'] : ['ffprobe']

export function ffmpegPath() {
  const cfg = readConfig()
  return process.env.FFMPEG || cfg.ffmpeg || onPath(ffNames) || jianying(ffNames) || null
}

export function ffprobePath() {
  return process.env.FFPROBE || onPath(probeNames) || jianying(probeNames) || null
}

export function requireFfmpeg() {
  const p = ffmpegPath()
  if (!p) throw new Error('找不到 ffmpeg（取帧要用）。装一个：winget install ffmpeg；或设环境变量 FFMPEG')
  return p
}

/** 视频宽高 + 时长（秒） */
export function probe(file) {
  const ff = requireFfmpeg()
  let width = 0, height = 0, duration = 0
  const fp = ffprobePath()
  if (fp) {
    const out = execFileSync(fp, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1', file], { encoding: 'utf8', windowsHide: true })
    for (const line of out.split('\n')) {
      const [k, v] = line.split('=')
      if (k === 'width') width = Number(v)
      else if (k === 'height') height = Number(v)
      else if (k === 'duration') duration = Number(v)
    }
  }
  if (!width || !height || !duration) {
    // 没有 ffprobe：从 ffmpeg 的 stderr 里抠（它打印 Stream 与 Duration 两行）
    let text = ''
    try {
      text = String(execFileSync(ff, ['-hide_banner', '-i', file],
        { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }))
    } catch (e) {
      text = String(e?.stderr || e?.stdout || e?.message || '')
    }
    if (!duration) {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
      if (m) duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    }
    if (!width || !height) {
      const m = /Stream #\d+:\d+.*?Video:.*?\b(\d{2,5})x(\d{2,5})\b/.exec(text)
      if (m) { width = Number(m[1]); height = Number(m[2]) }
    }
  }
  return { width, height, duration, ar: width && height ? width / height : 0 }
}

/** 找父插件下载的那条视频（同名多份时取最新的） */
export function findMp4(bv) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(String(bv))) return null
  let names = []
  try { names = fs.readdirSync(P.shots) } catch { return null }
  const hits = names
    .filter((n) => n.startsWith(bv + '-') && n.toLowerCase().endsWith('.mp4'))
    .map((n) => { const f = path.join(P.shots, n); return { f, m: fs.statSync(f).mtimeMs } })
    .sort((a, b) => b.m - a.m)
  return hits[0]?.f ?? null
}

/** 父插件留下的带时间戳字幕（shots/subs/<BV>-debrief.txt） */
export function readSubs(bv) {
  const f = path.join(P.subs, `${bv}-debrief.txt`)
  let text = ''
  try { text = fs.readFileSync(f, 'utf8') } catch { return [] }
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\[(\d{1,2}):(\d{2})\]\s*(.+)$/.exec(line.trim())
    if (m) rows.push({ sec: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() })
  }
  return rows
}

export const fmtTime = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
export const parseTime = (s) => {
  const t = String(s ?? '').trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)
  if (!m) return NaN
  return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
}

/** 按时刻抽一张**原始分辨率**帧（不是缩略图，直接可当 img2img 底图） */
export function frameAt(mp4, sec, out) {
  const ff = requireFfmpeg()
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ff, ['-y', '-loglevel', 'error', '-ss', Number(sec).toFixed(3), '-i', mp4,
    '-frames:v', '1', '-q:v', '2', out], { stdio: 'ignore', windowsHide: true, timeout: 60000 })
  if (!fs.existsSync(out)) throw new Error('取帧失败：' + out)
  return out
}

/** 在 [from,to] 里均匀抽 n 张缩略图，给模型"选景"看 */
export function burst(mp4, from, to, n, outDir, width = 480) {
  const ff = requireFfmpeg()
  fs.mkdirSync(outDir, { recursive: true })
  const span = Math.max(0.5, to - from)
  const step = span / Math.max(1, n)
  const out = []
  for (let i = 0; i < n; i += 1) {
    const sec = Math.min(to - 0.05, from + (i + 0.5) * step)
    const file = path.join(outDir, `f${String(i).padStart(2, '0')}.jpg`)
    try {
      execFileSync(ff, ['-y', '-loglevel', 'error', '-ss', sec.toFixed(3), '-i', mp4,
        '-frames:v', '1', '-vf', `scale=${width}:-1`, '-q:v', '3', file],
        { stdio: 'ignore', windowsHide: true, timeout: 60000 })
      if (fs.existsSync(file)) out.push({ sec: Number(sec.toFixed(2)), file })
    } catch { /* 单帧失败不影响其它 */ }
  }
  return out
}
