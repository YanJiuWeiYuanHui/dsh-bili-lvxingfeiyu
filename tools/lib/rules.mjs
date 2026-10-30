// 往 AGENTS.md 写/更新/撤掉「打卡守则」。
//
// 为什么要写进 AGENTS.md：父插件的 agent 每次会话都会读它，
// 而父插件**没有暴露任何扩展点**——不改它的代码，这是唯一可靠的注入位置。
//
// 三条硬要求：幂等（重装只替换块内）、可回滚（detach）、带作用域（只对 bili-whale 会话生效）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { P, readConfig } from './core.mjs'
import { findParentBili } from './parent.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..')
export const FEIYU_CMD = path.join(PLUGIN_ROOT, 'tools', 'feiyu.mjs')
const TEMPLATE = path.join(PLUGIN_ROOT, 'prompts', 'rules-block.md')

/** 扫 profile 的 node_modules，看装了哪些 B站 插件（dsh-bili-*） */
export function detectPlugins() {
  const found = new Map()
  const roots = []
  try { for (const n of fs.readdirSync(path.join(P.root, '..', 'profiles'))) roots.push(path.join(P.root, '..', 'profiles', n, 'node_modules')) } catch {}
  roots.push(path.join(P.root, '..', 'plugins'))
  for (const dir of roots) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!/^dsh-bili-/.test(name)) continue
      if (name === 'dsh-bili-lvxingfeiyu') continue   // 别把自己当成上游插件
      const keyword = name.replace(/^dsh-/, '')            // dsh-bili-whale → bili-whale
      found.set(name, { name, keyword, dir: path.join(dir, name) })
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 已知插件的"会话里会出现什么"补一下（子会话 id 可能不完全等于包名） */
const KEYWORD_HINT = { 'dsh-bili-whale': 'bili-whale', 'dsh-bili-scroll': 'bili-scroll' }
export function scopeKeywords(plugins) {
  return (plugins.length ? plugins : [{ name: 'dsh-bili-whale', keyword: 'bili-whale' }])
    .map((p) => KEYWORD_HINT[p.name] ?? p.keyword)
}

export const BEGIN = '<!-- lvxingfeiyu:begin'
export const END = '<!-- lvxingfeiyu:end -->'
export const VERSION = 'lvxingfeiyu:begin v1'

const blockRe = () => /<!-- lvxingfeiyu:begin[^>]*-->[\s\S]*?<!-- lvxingfeiyu:end -->/m

export function renderBlock() {
  let tpl = ''
  try { tpl = fs.readFileSync(TEMPLATE, 'utf8') } catch { return '' }
  // 父插件命令的绝对路径也写进去 —— 否则她的 cwd 里没有 bili.mjs，会全盘搜好几步
  let bili = 'bili.mjs'
  try { bili = findParentBili(readConfig()) || bili } catch {}
  return tpl
    .replaceAll('{{DAKA}}', FEIYU_CMD)
    .replaceAll('<DAKA>', FEIYU_CMD)
    .replaceAll('{{BILI}}', bili)
    .replaceAll('{{SCOPE}}', scopeKeywords(detectPlugins()).map((k) => '`' + k + '`').join('、'))
    .replaceAll('<BILI>', bili)
    .trim()
}

export function rulesStatus() {
  const plugins = detectPlugins()
  let text = ''
  try { text = fs.readFileSync(P.agents, 'utf8') } catch { return { attached: false, version: null, path: P.agents } }
  const m = blockRe().exec(text)
  if (!m) return { attached: false, version: null, path: P.agents, plugins }
  const v = /lvxingfeiyu:begin\s+(v\d+)/.exec(m[0])
  const stale = !m[0].includes(FEIYU_CMD)
  return { attached: true, version: v?.[1] ?? 'v?', path: P.agents, stale, plugins }
}

export function rulesAttach() {
  const block = renderBlock()
  if (!block) throw new Error('守则模板缺失：prompts/rules-block.md')
  let text = ''
  try { text = fs.readFileSync(P.agents, 'utf8') } catch {}
  const existed = blockRe().test(text)
  const next = existed ? text.replace(blockRe(), block) : (text.trimEnd() + (text.trim() ? '\n\n' : '') + block + '\n')
  fs.mkdirSync(path.dirname(P.agents), { recursive: true })
  fs.writeFileSync(P.agents, next, 'utf8')
  return { attached: true, version: 'v1', replaced: existed, path: P.agents, command: FEIYU_CMD }
}

export function rulesDetach() {
  let text = ''
  try { text = fs.readFileSync(P.agents, 'utf8') } catch { return { attached: false, path: P.agents } }
  if (!blockRe().test(text)) return { attached: false, path: P.agents }
  const next = text.replace(blockRe(), '').replace(/\n{3,}/g, '\n\n').trimEnd()
  // 文件本来就是为这一块建的 → 摘掉后空了就删掉，别留一个空文件在 DSH 里
  if (!next) {
    try { fs.rmSync(P.agents, { force: true }) } catch {}
    return { attached: false, removed: true, fileDeleted: true, path: P.agents }
  }
  fs.writeFileSync(P.agents, next + '\n', 'utf8')
  return { attached: false, removed: true, fileDeleted: false, path: P.agents }
}
