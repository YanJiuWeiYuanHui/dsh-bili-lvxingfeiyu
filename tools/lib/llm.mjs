// 极简文本模型通道（给"写小作文"用）
//
// 刻意不依赖任何插件：endpoint / model / key 全在 daka 自己的配置里。
// key 默认复用 secret.json（和生图同一个），也可以单独给 journal.api.key。
// 失败一律原样透传，不改写。
import { readSecret } from './core.mjs'

const join = (base, p) => String(base).replace(/\/+$/, '') + p

/**
 * @param {{endpoint:string, model:string, apiKey:string, prompt:string, system?:string, temperature?:number, maxTokens?:number, timeoutMs?:number}} o
 * @returns {Promise<{ok:boolean, text?:string, error?:string, http?:number, raw?:string}>}
 */
export async function chat(o) {
  const {
    endpoint, model, apiKey, prompt, system,
    temperature = 0.9, maxTokens = 2000, timeoutMs = 120000,
  } = o
  if (!endpoint || !model || !apiKey) return { ok: false, error: '文本模型没配全（endpoint / model / key）' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const messages = []
    if (system) messages.push({ role: 'system', content: system })
    messages.push({ role: 'user', content: prompt })
    const r = await fetch(join(endpoint, '/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: ctrl.signal,
    })
    const text = await r.text()
    let j = null
    try { j = JSON.parse(text) } catch {}
    if (!r.ok || !j || j.error) {
      return { ok: false, http: r.status, raw: (j ? JSON.stringify(j) : text).slice(0, 800), error: '文本模型返回错误' }
    }
    const out = j.choices?.[0]?.message?.content ?? ''
    if (!out.trim()) return { ok: false, http: r.status, error: '模型返回空内容' }
    return { ok: true, text: out.trim(), http: r.status, usage: j.usage ?? null }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, error: aborted ? `超时（${Math.round(timeoutMs / 1000)}s）` : String(e?.message ?? e) }
  } finally { clearTimeout(timer) }
}

/** 从配置里挑出"写日记"用的那套参数（没单独配就复用生图的 endpoint / 同一个 key） */
export function journalModel(cfg) {
  const j = cfg.journal?.api ?? {}
  const s = readSecret()
  return {
    endpoint: String(j.endpoint || cfg.api?.endpoint || '').trim(),
    model: String(j.model || '').trim(),
    apiKey: String(j.key || s.apiKey || '').trim(),
    temperature: Number(j.temperature ?? 0.9),
  }
}
