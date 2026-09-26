import config from './config.js'

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
