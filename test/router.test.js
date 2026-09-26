import { test, expect } from 'bun:test'
import { parseRoute } from '../src/router.js'

test('parseRoute 识别 legacy /api', () => {
  expect(parseRoute('/api', '')).toEqual({ kind: 'legacy' })
  expect(parseRoute('/api/', '')).toEqual({ kind: 'legacy' })
})

test('parseRoute 识别 RESTful 资源路径', () => {
  expect(parseRoute('/api/netease/song/123', '')).toEqual({ kind: 'resource', server: 'netease', type: 'song', id: '123' })
  expect(parseRoute('/api/tencent/url/abc/', '')).toEqual({ kind: 'resource', server: 'tencent', type: 'url', id: 'abc' })
})

test('parseRoute 识别 search 路径', () => {
  expect(parseRoute('/api/netease/search', '')).toEqual({ kind: 'search', server: 'netease' })
})

test('parseRoute 识别 demo', () => {
  expect(parseRoute('/demo', '')).toEqual({ kind: 'demo' })
  expect(parseRoute('/api/demo', '')).toEqual({ kind: 'demo' })
})

test('parseRoute 前缀与非法路径', () => {
  expect(parseRoute('/myprefix/api/netease/song/123', '/myprefix')).toEqual({ kind: 'resource', server: 'netease', type: 'song', id: '123' })
  expect(parseRoute('/api/netease', '')).toEqual({ kind: 'notfound' })
  expect(parseRoute('/api/netease/song', '')).toEqual({ kind: 'notfound' })
  expect(parseRoute('/api/netease/song/123/extra', '')).toEqual({ kind: 'notfound' })
  expect(parseRoute('/other', '')).toEqual({ kind: 'notfound' })
})
