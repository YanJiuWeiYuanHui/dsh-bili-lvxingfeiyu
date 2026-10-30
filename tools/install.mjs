#!/usr/bin/env node
// 一键安装：把 dsh-bili-lvxingfeiyu 接到某个 DSH profile 上。
//
//   node tools/install.mjs                 # 默认装到 desktop
//   node tools/install.mjs --profile web   # 装到别的 profile
//   node tools/install.mjs --copy          # 复制一份而不是建链接（发布用 tgz 时更稳）
//
// 它做三件事，和"手工接线"完全等价：
//   ① 在 profile/node_modules 下建链接（或复制）
//   ② 往 profile/package.json 的 dependencies 加 link:
//   ③ 把 dsh-bili-lvxingfeiyu 加进 dsh.profile.bundles
// 然后提示重启。**不会**碰任何已有插件。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const has = (k) => argv.includes('--' + k)
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }

const SELF = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SELF, '..')          // 插件根目录
const NAME = 'dsh-bili-lvxingfeiyu'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profile = opt('profile', 'desktop')
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', profile)

const log = (m) => console.log(m)
const die = (m) => { console.error('✗ ' + m); process.exit(1) }

// ── 0) 检查 ──
if (!fs.existsSync(PROFILE_DIR)) die(`找不到 profile：${PROFILE_DIR}\n  可能 profile 名字不对，看一眼 ${path.join(DSH_HOME, 'profiles')} 下有哪些`)
const pkgFile = path.join(PROFILE_DIR, 'package.json')
if (!fs.existsSync(pkgFile)) die(`profile 里没有 package.json：${pkgFile}`)
if (profile === 'desktop' && has('no-warn') === false) {
  log('提示：desktop profile 由 Electron 应用管理，装完要**完全退出 DSH 再打开**才生效。\n')
}

// ── 1) 建链接 ──
const nm = path.join(PROFILE_DIR, 'node_modules')
fs.mkdirSync(nm, { recursive: true })
const dest = path.join(nm, NAME)
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }

if (exists(dest)) {
  log(`① ${dest} 已存在，跳过`)
} else if (has('copy')) {
  fs.cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src),
  })
  log(`① 已复制 → ${dest}`)
} else {
  try {
    fs.symlinkSync(ROOT, dest, process.platform === 'win32' ? 'junction' : 'dir')
    log(`① 已建链接 → ${dest}`)
  } catch (e) {
    die(`建链接失败：${e.message}\n  改用：node tools/install.mjs --copy`)
  }
}

// ── 2) 写 package.json ──
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
const backup = pkgFile + '.bak-daka-install'
if (!fs.existsSync(backup)) fs.copyFileSync(pkgFile, backup)

pkg.dependencies = pkg.dependencies || {}
pkg.dependencies[NAME] = has('copy') ? 'file:' + ROOT.replace(/\\/g, '/') : 'link:' + ROOT.replace(/\\/g, '/')

pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
if (!bundles.includes(NAME)) bundles.push(NAME)
pkg.dsh.profile.bundles = bundles

fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
log(`② 已写 ${pkgFile}`)
log(`   dependencies["${NAME}"] = ${pkg.dependencies[NAME]}`)
log(`   bundles = ${bundles.join(', ')}`)

// ── 3) 提示 ──
log('\n③ 完成。下一步：')
log('   · **完全退出 DSH 再打开**（不是关窗口）')
log('   · 打开后进 设置 → 打卡，看到「接入父插件」就说明装上了')
log(`   · 数据目录：${path.join(DSH_HOME, 'lvxingfeiyu')}`)
log('')
log('   想自己刷视频（自动挑片）还需要装上游插件 dsh-bili-whale；')
log('   只装 daka 也能用：手动给 BV 号即可，见 README。')
log('')
log('   卸载：删掉 profile/node_modules/' + NAME + '，再把 package.json 里那两项去掉（备份在 ' + path.basename(backup) + '）')
