// ╔══════════════════════════════════════════════════════════════════════╗
// ║  ★ 适配层（1/2）—— 要把 daka 接到「别的刷 B 站插件」，只改这个对象  ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// 换插件的步骤，三选一：
//   A. 对方有命令行入口 → 只改下面的 name / entry / configFile（或者干脆在设置页填「父插件路径」）
//   B. 对方没有命令行   → 不用改，daka 的 fetch.mjs 会自己下视频（见同目录 fetch.mjs）
//   C. 对方命令名不一样 → 改 commands 里对应的那一行，左边是 daka 的用途，右边是对方的参数
//
// 我们**只调用**它的命令：不读它的 cookie、不连 B 站、不改它的代码。
// 找不到就明说找不到 —— 不猜路径、不静默降级。
export const ADAPTER = {
  // 对方的 npm 包名（会去 profiles/*/node_modules/<name>/ 下找）
  name: 'dsh-bili-whale',
  // 包内到命令行的路径
  entry: ['tools', 'bili.mjs'],
  // 对方的配置文件（只用来判断"装没装好"，不读内容）
  configFile: 'bili-whale.config.json',
  // daka 会用到的上游命令。<BV> <TEXT> <FILE> 是我们填的参数占位
  commands: {
    // 看视频：封面/字幕/弹幕/抽帧（可选 —— fetch.mjs 能自己下片，缺这条也能跑）
    debrief: ['debrief', '<BV>'],
    // 纯文字私信（链接分享、push 用）
    dm: ['dm', '--msg', '<TEXT>', '--go'],
    // 图文动态（可选）
    dynamicImage: ['dynamic-image', '--image', '<FILE>', '--text', '<TEXT>', '--go'],
    // 结构化事件流（可选）
    diaryLog: ['diary', 'log', 'drive'],
  },
}

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DSH_HOME } from './core.mjs'

const exists = (f) => { try { return fs.statSync(f).isFile() } catch { return false } }
const isDir = (d) => { try { return fs.statSync(d).isDirectory() } catch { return false } }

function candidates(cfg) {
  const out = []
  if (cfg?.parent?.bili) out.push(cfg.parent.bili)
  // DSH 的 profile 里以 link 安装的插件会解析到真实目录
  const profiles = path.join(DSH_HOME, 'profiles')
  try {
    for (const name of fs.readdirSync(profiles)) {
      out.push(path.join(profiles, name, 'node_modules', ADAPTER.name, ...ADAPTER.entry))
    }
  } catch {}
  out.push(path.join(DSH_HOME, 'plugins', ADAPTER.name, ...ADAPTER.entry))
  out.push(path.join(DSH_HOME, 'plugins', 'bili-whale', ...ADAPTER.entry))
  return [...new Set(out)]
}

export function findParentBili(cfg) {
  for (const f of candidates(cfg)) if (exists(f)) return f
  return null
}

/** 父插件是否已经配好（只读判断，不发请求） */
export function parentState(cfg) {
  const bili = findParentBili(cfg)
  const configFile = path.join(DSH_HOME, ADAPTER.configFile)
  const credFile = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.bili-ai', 'credentials.json')
  return {
    found: !!bili,
    bili,
    configFile: exists(configFile),
    credentials: exists(credFile),
    checked: candidates(cfg).slice(0, 4),
  }
}

/** 调父插件命令；stdout/stderr 原样带回，不做任何改写 */
export function runParent(bili, args, { timeoutMs = 300000, dry = false } = {}) {
  if (!bili) return { ok: false, code: -1, stdout: '', stderr: '找不到父插件的 bili.mjs' }
  if (dry) return { ok: true, code: 0, stdout: '[dry] 未执行：' + [bili, ...args].join(' '), stderr: '', dry: true }
  const r = spawnSync(process.execPath, [bili, ...args], {
    encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  })
  return {
    ok: r.status === 0,
    code: r.status ?? -1,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? '') || (r.error ? String(r.error.message) : ''),
  }
}

/** 给 CLI 用的自检：路径在、bili.mjs 在、命令能列出来 */
export function parentSelftest(cfg) {
  const st = parentState(cfg)
  if (!st.found) return { ok: false, reason: `没找到父插件 ${ADAPTER.name}/${ADAPTER.entry.join('/')}（先在设置里填「父插件路径」，或先装它）`, ...st }
  const r = runParent(st.bili, ['help'], { timeoutMs: 20000 })
  return { ok: r.ok, reason: r.ok ? '父插件命令可用' : (r.stderr || r.stdout).slice(0, 300), ...st }
}

export { isDir }
