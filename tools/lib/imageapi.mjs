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

// ─────────────────────────────────────────────────────────────────────────────
// ComfyUI 驱动（本地部署用）
//
// 为什么单独一条：ComfyUI 不认 OpenAI 的 /images/edits，它要"工作流 JSON"。
// 做法是把你的工作流当模板做**文本替换**，不需要理解节点结构：
//
//   在 ComfyUI 里点「Save (API Format)」导出 JSON，然后在里面把要变的地方写成占位符：
//     {{prompt}}       → 提示词
//     {{ref1}} {{ref2}} … {{refN}}  → 上传后的参考图文件名（顺序同设置页的参考图）
//     {{width}} {{height}}          → 尺寸（来自 size，例如 1024x1024）
//     {{seed}}                       → 随机种子
//
// 流程：上传图 → 填模板 → POST /prompt → 轮询 /history → 取 /view
// ─────────────────────────────────────────────────────────────────────────────

const fillTemplate = (obj, vars) => {
  const json = JSON.stringify(obj)
  // 只替换字符串里出现的 {{x}}，不做结构推断
  const out = json.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in vars)) return m
    return String(vars[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  })
  return JSON.parse(out)
}

async function uploadImage(endpoint, apiKey, file, extraHeaders) {
  const buf = fs.readFileSync(file)
  const fd = new FormData()
  fd.append('image', new Blob([buf], { type: MIME(path.extname(file)) }), path.basename(file))
  fd.append('overwrite', 'true')
  const r = await fetch(join(endpoint, '/upload/image'), {
    method: 'POST', headers: headersFor(apiKey, extraHeaders), body: fd,
  })
  const { json, text } = await readBody(r)
  if (!r.ok || !json) throw new Error('上传参考图失败：' + (json ? JSON.stringify(json) : text).slice(0, 300))
  return json.name ?? json.data?.name ?? path.basename(file)
}

export async function generateComfy(o) {
  const {
    endpoint, apiKey, workflow, prompt, refs = [], size = '1024x1024',
    extraHeaders = {}, timeoutMs = 300000, pollMs = 1500,
  } = o
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const [width, height] = String(size).split('x').map((n) => Number(n) || 1024)
  try {
    const wf = typeof workflow === 'string'
      ? JSON.parse(fs.readFileSync(workflow, 'utf8'))
      : workflow
    if (!wf || typeof wf !== 'object') throw new Error('工作流不是合法 JSON')

    // 1) 上传参考图（按顺序）
    const vars = { prompt, width, height, seed: Math.floor(Math.random() * 1e15) }
    for (let i = 0; i < refs.length; i += 1) {
      vars['ref' + (i + 1)] = await uploadImage(endpoint, apiKey, refs[i], extraHeaders)
    }

    // 2) 填模板
    const filled = fillTemplate(wf, vars)

    // 3) 提交
    const clientId = 'daka-' + Math.random().toString(36).slice(2, 10)
    const rq = await fetch(join(endpoint, '/prompt'), {
      method: 'POST',
      headers: { ...headersFor(apiKey, extraHeaders), 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: filled, client_id: clientId }),
      signal: ctrl.signal,
    })
    const { json, text } = await readBody(rq)
    if (!rq.ok || !json || json.error || !json.prompt_id) {
      return { ok: false, http: rq.status, raw: (json ? JSON.stringify(json) : text).slice(0, 1200), mode: 'comfy' }
    }
    const id = json.prompt_id

    // 4) 轮询
    let out = null
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs))
      const rh = await fetch(join(endpoint, '/history/' + id), { headers: headersFor(apiKey, extraHeaders), signal: ctrl.signal })
      const hj = await readBody(rh)
      const item = hj.json?.[id]
      if (item?.outputs) { out = item.outputs; break }
      if (item?.status?.status_str === 'error') {
        return { ok: false, http: rh.status, raw: JSON.stringify(item.status).slice(0, 800), mode: 'comfy' }
      }
    }
    if (!out) return { ok: false, http: 0, error: '等 ComfyUI 出图超时', mode: 'comfy' }

    // 5) 取第一张图
    let img = null
    for (const node of Object.values(out)) {
      const list = node?.images ?? node?.gifs
      if (Array.isArray(list) && list.length) { img = list[0]; break }
    }
    if (!img) return { ok: false, http: 0, error: '工作流跑完了但没有图片输出（检查 SaveImage 节点）', mode: 'comfy' }
    const q = new URLSearchParams({ filename: img.filename ?? '', subfolder: img.subfolder ?? '', type: img.type ?? 'output' })
    const rv = await fetch(join(endpoint, '/view?' + q.toString()), { headers: headersFor(apiKey, extraHeaders), signal: ctrl.signal })
    if (!rv.ok) return { ok: false, http: rv.status, error: '下载生成的图失败', mode: 'comfy' }
    return { ok: true, http: rv.status, buf: Buffer.from(await rv.arrayBuffer()), mode: 'comfy' }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, http: 0, error: aborted ? '超时（' + Math.round(timeoutMs / 1000) + ' 秒）' : String(e?.message ?? e), mode: 'comfy' }
  } finally { clearTimeout(timer) }
}

export async function generate(o) {
  const {
    endpoint, apiKey, model, size = '1024x1024', prompt,
    refs = [], extraHeaders = {}, timeoutMs = 180000,
    multipartField = 'image[]',
  } = o
  // 本地 ComfyUI 走工作流模式
  if (String(o.kind ?? 'openai') === 'comfy') {
    return generateComfy({ ...o, workflow: o.workflow })
  }
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
