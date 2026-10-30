// dsh-bili-lvxingfeiyu 共用核心：路径 / 配置 / 密钥 / 账本 / 队列
//
// 原则：所有状态都是**普通文件**，人随时能打开看；不建数据库、不起守护进程。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

/** 用户主目录（Windows 优先 USERPROFILE，与父插件一致）。 */
export const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir() || '.'
/** DSH home：与宿主半边完全一致的解析顺序。 */
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
/** 本插件的数据根目录（与父插件的 whale-* 并列，互不覆盖）。 */
// 插件自己的目录（跟 DSH_HOME 无关，用来找包里自带的 assets）
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const ROOT = path.join(DSH_HOME, 'lvxingfeiyu')

export const P = {
  root: ROOT,
  config: path.join(DSH_HOME, 'lvxingfeiyu.config.json'),
  secret: path.join(ROOT, 'secret.json'),
  refs: path.join(ROOT, 'refs'),
  refsIndex: path.join(ROOT, 'refs', 'refs.json'),
  album: path.join(ROOT, 'album'),
  albumIndex: path.join(ROOT, 'album.jsonl'),
  frames: path.join(ROOT, 'frames'),
  tmp: path.join(ROOT, 'tmp'),
  draft: path.join(ROOT, 'draft.json'),
  quota: path.join(ROOT, 'quota.json'),
  agents: path.join(DSH_HOME, 'AGENTS.md'),
  // 只读：父插件已经下到本地的素材
  shots: path.join(DSH_HOME, 'shots', 'video'),
  subs: path.join(DSH_HOME, 'shots', 'subs'),
}

export const DEFAULTS = {
  enabled: true,
  mode: 'manual',                 // manual | auto
  daily: 1,                       // 每天最多几个打卡点
  perVideo: 1,                    // 同一 BV 最多几张
  api: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-image-2',
    size: 'follow',               // follow = 跟截图同比例 | 显式 "1536x1024"
    extraHeaders: {},
    timeoutMs: 180000,
  },
  candidates: { segments: 3, burst: 7, windowSec: 6 },
  // 清理：三类分开管（原片最占地方；打卡图是作品，默认不动）
  clean: {
    videos: { auto: true, days: 2, keepPerBv: 1 },
    albums: { auto: false, days: 0 },
    tmp: { auto: true, days: 2 },
  },
  // 人物外观：留空则用参考图的 note 拼。写清楚发色/瞳色/服装/配饰/尾巴，一致性会明显变好
  character: { note: '' },
  // 负向词：默认就带上"结构崩坏"那一套，不指望模型每次都想起来
  prompt: {
    suffix: '',
    negative: '多余的手臂、多余的手指、六根手指、第三条腿、双头、头部与胸部融合、身体部位粘连、重复肢体、断肢、比例失调、五官错位、背景被重绘、其他人物、文字、水印、马赛克、尾巴断裂、尾巴与身体分离、多条尾巴、尾鳍缺失、尾巴被画面裁切、尾巴像平贴的图案、肢体被裁切、人物被画框切边、把设定图的多个视角拼在一起',
  },
  publish: {
    mode: 'manual',               // manual | auto | auto-if-good
    dest: ['album'],              // album | dynamic | comment | dm | dm-image | desktop
    textTemplate: '#她在打卡# {line}\n来自 {bv} 的 {time}',
    minScore: 13,
    comment: { reason: '她在视频里找到了一个值得站进去的地方' },
  },
  parent: { bili: '' },           // 父插件 bili.mjs 的绝对路径；留空自动找
}

export const deepMerge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] ?? {}, v) : v
  }
  return out
}

// 首次运行：把包里自带的那张角色图落到数据目录（只做一次，绝不覆盖用户自己加的）
export function seedDefaultRefs() {
  try {
    if (fs.existsSync(P.refsIndex)) return false
    const src = path.join(PKG_ROOT, 'assets', 'default-refs')
    if (!fs.existsSync(src)) return false
    fs.mkdirSync(P.refs, { recursive: true })
    for (const n of fs.readdirSync(src)) {
      const to = path.join(P.refs, n)
      if (!fs.existsSync(to)) fs.copyFileSync(path.join(src, n), to)
    }
    return true
  } catch { return false }
}

export function ensureDirs() {
  for (const d of [P.root, P.refs, P.album, P.frames, P.tmp]) fs.mkdirSync(d, { recursive: true })
  seedDefaultRefs()
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

/** 原子写：临时文件 → rename。中途失败不会留下半个 JSON。 */
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
    fs.renameSync(tmp, file)
  } finally { try { fs.rmSync(tmp, { force: true }) } catch {} }
}

export function readConfig() {
  const user = readJson(P.config, {}) || {}
  return { ...deepMerge(DEFAULTS, user), __hasUserFile: Object.keys(user).length > 0 }
}

export function writeConfig(next) {
  const clean = { ...next }
  delete clean.__hasUserFile
  writeJsonAtomic(P.config, clean)
  return clean
}

/** Windows：把文件 ACL 收紧到当前用户；其它平台 chmod 600。 */
export function protectFile(file) {
  if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o600) } catch {} ; return }
  try {
    const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    const opts = { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    const sid = execFileSync(path.join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], opts).match(/S-1-\d+(?:-\d+)+/)?.[0]
    if (!sid) return
    execFileSync(path.join(system, 'icacls.exe'), [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`, '/Q'], opts)
  } catch { /* 收紧失败不阻断使用，只是权限更宽 */ }
}

/** 密钥只存在这里；永不回显、永不进 prompt。 */
export function readSecret() {
  const j = readJson(P.secret, {}) || {}
  return { apiKey: String(j.apiKey ?? ''), present: !!String(j.apiKey ?? '').trim() }
}

export function writeSecret(apiKey) {
  ensureDirs()
  writeJsonAtomic(P.secret, { apiKey: String(apiKey ?? '') })
  protectFile(P.secret)
  return { present: !!String(apiKey ?? '').trim() }
}

export const today = () => new Date().toLocaleDateString('sv-SE')
export const nowISO = () => new Date().toISOString()

export function readQuota() {
  const q = readJson(P.quota, {}) || {}
  const d = today()
  return q.date === d ? { date: d, count: Number(q.count ?? 0), byBv: q.byBv ?? {} } : { date: d, count: 0, byBv: {} }
}

export function bumpQuota(bv) {
  const q = readQuota()
  q.count += 1
  if (bv) q.byBv[bv] = nowISO()
  writeJsonAtomic(P.quota, q)
  return q
}

/** 剩余额度：0 = 今天不能再打卡 */
export function quotaLeft(cfg = readConfig()) {
  const q = readQuota()
  return Math.max(0, Number(cfg.daily ?? 1) - q.count)
}

export function albumAppend(rec) {
  ensureDirs()
  fs.appendFileSync(P.albumIndex, JSON.stringify(rec) + '\n')
  return rec
}

export function albumList(n = 20) {
  let lines = []
  try { lines = fs.readFileSync(P.albumIndex, 'utf8').split(/\r?\n/).filter(Boolean) } catch {}
  return lines.slice(-n).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse()
}

export function draftRead() {
  const d = readJson(P.draft, { items: [] }) || { items: [] }
  if (!Array.isArray(d.items)) d.items = []
  return d
}

export function draftWrite(d) { writeJsonAtomic(P.draft, d) }
