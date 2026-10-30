// 找真正的 node.exe（宿主跑在 Electron 里，process.execPath 是主程序，不是 node）
//
// 只有「需要调子进程」的三件事用得到它：拉模型列表、生成图、发布。
// 其余（配置/密钥/参考图/守则/相册）都在宿主里直接用 fs，不需要 node。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const isWin = process.platform === 'win32'
const bin = isWin ? 'node.exe' : 'node'
const cache = new Map()

function probe(file, env) {
  let dir
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daka-node-'))
    const proof = path.join(dir, 'proof')
    const r = spawnSync(file, ['-e', 'require("fs").writeFileSync(process.argv[1],process.versions.node)', proof],
      { env, stdio: 'ignore', windowsHide: true, timeout: 10000 })
    return !r.error && r.status === 0 && /^\d+\./.test(fs.readFileSync(proof, 'utf8'))
  } catch { return false } finally { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} } }
}

/** @returns {{file:string, env:object}} 找不到就抛 */
export function resolveRuntime(dshHome) {
  if (cache.has(dshHome)) return cache.get(dshHome)
  const env = process.env
  const candidates = [env.DSH_NODE, env.DAKA_NODE, env.DSH_DESKTOP_NODE_EXECUTABLE]
  for (const root of new Set([path.join(dshHome, 'dsh-runtimes'), path.join(os.homedir(), '.dsh', 'dsh-runtimes')])) {
    try { for (const d of fs.readdirSync(root)) candidates.push(path.join(root, d, 'dependencies', 'node', 'bin', bin)) } catch {}
  }
  for (const dir of String(env.PATH ?? '').split(path.delimiter)) if (dir) candidates.push(path.join(dir.replace(/^"|"$/g, ''), bin))
  if (isWin && env.ProgramFiles) candidates.push(path.join(env.ProgramFiles, 'nodejs', bin))
  if (!isWin) candidates.push('/usr/local/bin/node', '/usr/bin/node', '/opt/homebrew/bin/node')
  for (const file of [...new Set(candidates.filter(Boolean))]) {
    try { if (fs.statSync(file).isFile() && probe(file, env)) { const hit = { file, env: { ...env } }; cache.set(dshHome, hit); return hit } } catch {}
  }
  // 兜底：Electron 以 node 身份跑（能跑，但行为与真 node 有差异）
  if (process.versions.electron) {
    const e = { ...env, ELECTRON_RUN_AS_NODE: '1' }
    if (probe(process.execPath, e)) { const hit = { file: process.execPath, env: e }; cache.set(dshHome, hit); return hit }
  }
  throw new Error('找不到可用的 node 运行时（设 DSH_NODE 为 node.exe 的绝对路径）')
}
