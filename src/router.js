import config from './config.js'
import { resolve } from './service/api.js'
import demoService from './service/demo.js'

/**
 * 纯函数:把请求路径解析为路由描述,供 router 与测试复用。
 * 归一化顺序:去掉 prefix → 去掉末尾斜杠 → 匹配。
 */
export function parseRoute (pathname, prefix = config.http.prefix) {
  let p = pathname
  if (prefix && p.startsWith(prefix)) {
    p = p.slice(prefix.length) || '/'
  }
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)

  if (p === '/demo') return { kind: 'demo' }
  if (p === '/api') return { kind: 'legacy' }

  if (p.startsWith('/api/')) {
    const segs = p.slice('/api/'.length).split('/').filter(Boolean)
    if (segs.length === 1 && segs[0] === 'demo') return { kind: 'demo' }
    if (segs.length === 2 && segs[1] === 'search') return { kind: 'search', server: segs[0] }
    if (segs.length === 3) return { kind: 'resource', server: segs[0], type: segs[1], id: segs[2] }
  }

  return { kind: 'notfound' }
}

export async function route (request, ctx) {
  const url = new URL(request.url)
  const parsed = parseRoute(url.pathname)

  switch (parsed.kind) {
    case 'legacy': {
      const q = url.searchParams
      return resolve(request, ctx, {
        server: q.get('server') || 'netease',
        type: q.get('type') || 'search',
        id: q.get('id') || 'hello',
        token: q.get('token') || q.get('auth') || 'token'
      })
    }
    case 'search':
      return resolve(request, ctx, {
        server: parsed.server,
        type: 'search',
        id: url.searchParams.get('keywords') || 'hello',
        token: url.searchParams.get('token') || url.searchParams.get('auth') || 'token'
      })
    case 'resource':
      return resolve(request, ctx, {
        server: parsed.server,
        type: parsed.type,
        id: parsed.id,
        token: url.searchParams.get('token') || url.searchParams.get('auth') || 'token'
      })
    case 'demo':
      return demoService(request)
    default:
      return new Response('Not Found', { status: 404 })
  }
}
