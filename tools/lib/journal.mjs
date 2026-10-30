// 旅游日记 —— 她写的"小作文"（不是结构化摘要）
//
// 一篇 = 一次打卡 = 一个视频。正文是 Markdown，存在 <daka>/journal/<albumId>.md。
// 谁写？**她**（或任何 agent）。这里只提供三件事：人设怎么取、提示词怎么拼、正文怎么存取。
// 人设与父插件**共用同一个文件** `~/.bili-ai/persona.md` —— 改一次两边都变。
import fs from 'node:fs'
import path from 'node:path'
import { P, ROOT, readConfig, albumList } from './core.mjs'

export const JOURNAL_DIR = path.join(ROOT, 'journal')
const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const PERSONA_FILE = path.join(HOME, '.bili-ai', 'persona.md')
export const OWN_PERSONA = path.join(ROOT, 'persona.md')

/** 人设：优先父插件那份 persona.md，其次设置里的「人物外观」，最后neutral */
export function personaText(cfg = readConfig()) {
  // ① daka 自己那份（只装 daka 的人用这个）
  try {
    const own = fs.readFileSync(OWN_PERSONA, 'utf8').trim()
    if (own) return { text: own.slice(0, 20000), from: OWN_PERSONA, source: 'own' }
  } catch {}
  // ② 父插件那份（装了 dsh-bili-whale 就自动共用，不用再写一遍）
  let t = ''
  try { t = fs.readFileSync(PERSONA_FILE, 'utf8').trim() } catch {}
  if (t) return { text: t.slice(0, 20000), from: PERSONA_FILE, source: 'parent' }
  const note = String(cfg.character?.note ?? '').trim()
  if (note) return { text: note, from: '设置 → 人物外观' }
  return { text: '', from: '(没有设置人设)', source: 'none' }
}

const ensure = () => fs.mkdirSync(JOURNAL_DIR, { recursive: true })
export const journalPath = (id) => path.join(JOURNAL_DIR, `${String(id).replace(/[^\w.-]/g, '_')}.md`)

export function readJournal(id) {
  try { return fs.readFileSync(journalPath(id), 'utf8') } catch { return '' }
}

export function writeJournal(id, text) {
  ensure()
  const clean = String(text ?? '').trim()
  if (!clean) throw new Error('正文是空的')
  fs.writeFileSync(journalPath(id), clean + '\n', 'utf8')
  return { id, chars: clean.replace(/\s/g, '').length, file: journalPath(id) }
}

export function listJournal() {
  try {
    return fs.readdirSync(JOURNAL_DIR).filter((n) => n.endsWith('.md')).map((n) => ({ id: n.slice(0, -3), file: path.join(JOURNAL_DIR, n), bytes: fs.statSync(path.join(JOURNAL_DIR, n)).size }))
  } catch { return [] }
}

/**
 * 拼"叫她写"的提示词。agent 拿到这段，写完再 `daka journal write`。
 * @param {{id,bv,t,line,action,why,score,date,title,subtitle}} rec
 */
/** 前 N 天去过哪儿，给写作当上下文 */
export function journalContext(rec, cfg = readConfig()) {
  const days = Math.max(0, Number(cfg.journal?.contextDays ?? 3))
  if (!days) return []
  const here = Number.isFinite(Date.parse(rec.at ?? '')) ? Date.parse(rec.at) : Date.now()
  const since = here - days * 86400000
  return albumList(500)
    .filter((r) => r.ok && r.id !== rec.id && Date.parse(r.at ?? '') >= since && Date.parse(r.at ?? '') < here)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((r) => ({
      date: String(r.at).slice(0, 10), bv: r.bv, t: r.t,
      line: r.card?.line ?? '', action: r.card?.action ?? '',
      title: (readJournal(r.id).split('\n').find((x) => x.trim().startsWith('# ')) ?? '').replace(/^#\s*/, '').slice(0, 50),
    }))
}

export function buildJournalPrompt(rec, cfg = readConfig(), cmd = '') {  const p = personaText(cfg)
  const L = []
  if (p.text) {
    L.push('【你是谁】下面是你的人设，写日记时必须按它来（口吻、称呼、在意的东西、底线）：')
    L.push(p.text)
    L.push('')
  } else {
    L.push('【你是谁】（没有配置人设：用中性第一人称写，不要自称"人家"，不要撒娇。）')
    L.push('')
  }
  L.push('【现在要写的】这次打卡的一篇旅行日记。**第一人称**，**500 字起步**，写成一篇小作文，不是流水账。')
  L.push('')
  L.push('事实（只准用这些，不要编造没发生的事）：')
  L.push(`- 日期：${rec.date ?? ''}`)
  L.push(`- 视频：《${rec.title || rec.bv}》${rec.title ? `（${rec.bv}）` : ''}`)
  L.push(`- 那一刻：${rec.t ?? ''}${rec.line ? ` —— 画面里在说「${rec.line}」` : ''}`)
  if (rec.action) L.push(`- 我在那儿做的事：${rec.action}`)
  if (rec.why) L.push(`- 为什么选这里：${rec.why}`)
  if (rec.score != null) L.push(`- 我当时给它的分：${rec.score}/20`)
  L.push('')
  const ctx = journalContext(rec, cfg)
  if (ctx.length) {
    L.push(`这几天的上下文（前几天去过的地方；可以顺口提一句，但**不要重复写前一天写过的内容**）：`)
    for (const c of ctx) {
      L.push(`- ${c.date} ${c.t} ${c.bv}` +
        (c.title ? `《${c.title}》` : '') +
        (c.line ? ` 那一刻在说「${String(c.line).slice(0, 60)}」` : '') +
        (c.action ? ` 我在那儿：${String(c.action).slice(0, 60)}` : ''))
    }
    L.push('')
  }
  L.push('写法要求：')
  L.push('- **第一行是标题**，写成 Markdown 一级标题，例如 `# 通天阁的黄昏`；要有画面感，不要写"今日游记"这种')
  L.push('- 标题下面空一行再写正文；正文里不要再出现小标题，也不要 1) 2) 3) 分段')
  L.push('- 第一人称，像真的去过那样写：先写怎么到的、看到什么、听到什么、站了多久')
  L.push('- **要有碎碎念**：走神、吐槽、突然想到的另一件事、后悔没多站一会儿——这些比描述更重要')
  L.push('- 允许情绪：喜欢、无聊、不想说话、想起主人。真实比漂亮重要')
  L.push('- 不要写"作为 AI""作为模型"，不要解释工具怎么工作，不要提插件/API/密钥')
  L.push('- 不要总结全文，不要加标题以外的结构（不要 1) 2) 3)）')
  L.push('')
  L.push('输出：只给正文 Markdown，不要代码块包裹，不要任何解释。')
  L.push('')
  if (cmd) L.push(`写完后存回去（正文用 --file 传，或从 stdin）：\n  node "${cmd}" journal write --id ${rec.id} --file <你写的.md>`)
  else L.push(`写完后存回去：node feiyu.mjs journal write --id ${rec.id}`)
  return L.join('\n')
}
