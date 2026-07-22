import type { Env } from './types'

function brainStub(env: Env): DurableObjectStub {
  if (!env.BRAIN_STORE) throw new Error('Brain v2 storage is not configured')
  return env.BRAIN_STORE.get(env.BRAIN_STORE.idFromName('bestcode-brain-v2'))
}

export async function handleBrainApi(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/brain/')) return null
  const suffix = url.pathname.slice('/api/brain'.length)
  const target = new URL(`https://brain-store${suffix}${url.search}`)
  const init: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': req.headers.get('Content-Type') ?? 'application/json' },
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body
  return brainStub(env).fetch(new Request(target, init))
}
