// 生图 API 适配层 —— 只认"图进、图出"，不判断内容。
//
// 约定（重要）：
//   · 密钥只在本进程里读，**不作为任何命令的入参**，也不打印
//   · 返回值只有 **Buffer + 元信息**；路径由调用方写盘
//   · 失败**原样透传** API 的响应，不改写、不降级、不静默重试
import fs from 'node:fs'
import path from 'node:path'

const MIME = (ext) => ({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}[String(ext).toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream')

const join = (base, p) => String(base).replace(/\/+$/, '') + p

function headersFor(apiKey, extra = {}) {
  return { authorization: 'Bearer ' + apiKey, ...extra }
}

async function readBody(r) {
  const text = await r.text()
  try { return { json: JSON.parse(text), text } } catch { return { json: null, text } }
}

/** 把 API 返回的 data[0] 变成 Buffer（兼容 b64_json / url 两种） */
async function dataToBuffer(item) {
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64')
  if (item?.url) {
    const r = await fetch(item.url, { redirect: 'follow' })
    if (!r.ok) throw new Error(`下载生成图失败 HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  throw new Error('返回里既没有 b64_json 也没有 url')
}

export async function listModels({ endpoint, apiKey, extraHeaders = {}, timeoutMs = 30000 }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(join(endpoint, '/models'), { headers: headersFor(apiKey, extraHeaders), signal: ctrl.signal })
    const { json, text } = await readBody(r)
    if (!r.ok || !json) return { ok: false, http: r.status, raw: text.slice(0, 500), models: [] }
    const models = (json.data ?? json.models ?? [])
      .map((m) => (typeof m === 'string' ? m : m?.id ?? m?.name))
      .filter(Boolean)
      .sort()
    return { ok: true, http: r.status, models }
  } catch (e) {
    return { ok: false, http: 0, raw: String(e?.message ?? e), models: [] }
  } finally { clearTimeout(timer) }
}

/** 尺寸：跟随截图比例，映射到 API 支持的档位 */
export function sizeFor(ar, sizeCfg = 'follow') {
  const explicit = /^\d+x\d+$/.test(String(sizeCfg ?? ''))
  if (explicit) return String(sizeCfg)
  if (!ar || !Number.isFinite(ar)) return '1024x1024'
  const buckets = [
    { s: '1536x1024', ar: 1.5 },
    { s: '1024x1024', ar: 1.0 },
    { s: '1024x1536', ar: 0.667 },
  ]
  return buckets.reduce((best, b) => (Math.abs(b.ar - ar) < Math.abs(best.ar - ar) ? b : best), buckets[0]).s
}

/**
 * 生成一张图。
 * @param {{endpoint,apiKey,model,size,prompt,refs?:string[],extraHeaders?,timeoutMs?,multipartField?}} o
 * @returns {Promise<{ok:boolean,buf?:Buffer,http:number,raw?:string,usage?:object,error?:string,mode:string}>}
 */
export async function generate(o) {
  const {
    endpoint, apiKey, model, size = '1024x1024', prompt,
    refs = [], extraHeaders = {}, timeoutMs = 180000,
    multipartField = 'image[]',
  } = o
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const useEdits = refs.length > 0
  try {
    let r
    if (useEdits) {
      const fd = new FormData()
      fd.append('model', model)
      fd.append('prompt', prompt)
      fd.append('size', size)
      fd.append('n', '1')
      for (const f of refs) {
        const buf = fs.readFileSync(f)
        fd.append(multipartField, new Blob([buf], { type: MIME(path.extname(f)) }), path.basename(f))
      }
      r = await fetch(join(endpoint, '/images/edits'), {
        method: 'POST', headers: headersFor(apiKey, extraHeaders), body: fd, signal: ctrl.signal,
      })
    } else {
      r = await fetch(join(endpoint, '/images/generations'), {
        method: 'POST',
        headers: { ...headersFor(apiKey, extraHeaders), 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, size, n: 1 }),
        signal: ctrl.signal,
      })
    }
    const { json, text } = await readBody(r)
    if (!r.ok || !json || json.error) {
      return { ok: false, http: r.status, raw: (json ? JSON.stringify(json) : text).slice(0, 1200), mode: useEdits ? 'edits' : 'generations' }
    }
    const item = json.data?.[0]
    const buf = await dataToBuffer(item)
    return { ok: true, http: r.status, buf, usage: json.usage ?? null, mode: useEdits ? 'edits' : 'generations' }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, http: 0, error: aborted ? `超时（${Math.round(timeoutMs / 1000)} 秒）` : String(e?.message ?? e), mode: useEdits ? 'edits' : 'generations' }
  } finally { clearTimeout(timer) }
}
