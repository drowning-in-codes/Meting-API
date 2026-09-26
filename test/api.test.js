import { test, expect } from 'bun:test'
import { resolve, buildItem } from '../src/service/api.js'
import { createApp } from '../src/app.js'

test('resolve 非法 server 返回 400', async () => {
  let status = 0
  try {
    await resolve(new Request('http://x'), { responseHeaders: new Headers() }, { server: 'invalid', type: 'song', id: '1', token: 'token' })
  } catch (e) { status = e.status }
  expect(status).toBe(400)
})

test('resolve 非法 type 返回 400', async () => {
  let status = 0
  try {
    await resolve(new Request('http://x'), { responseHeaders: new Headers() }, { server: 'netease', type: 'invalid', id: '1', token: 'token' })
  } catch (e) { status = e.status }
  expect(status).toBe(400)
})

test('resolve 鉴权失败返回 401', async () => {
  let status = 0
  try {
    await resolve(new Request('http://x'), { responseHeaders: new Headers() }, { server: 'netease', type: 'url', id: '123', token: 'definitely-wrong' })
  } catch (e) { status = e.status }
  expect(status).toBe(401)
})

test('buildItem 生成 legacy 格式回调 URL', () => {
  const item = buildItem('netease', { name: '歌名', artist: ['甲', '乙'], url_id: '111', pic_id: '222', lyric_id: '333' })
  expect(item.title).toBe('歌名')
  expect(item.author).toBe('甲 / 乙')
  expect(item.url).toContain('/api?server=netease&type=url&id=111&auth=')
  expect(item.pic).toContain('/api?server=netease&type=pic&id=222&auth=')
  expect(item.lrc).toContain('/api?server=netease&type=lrc&id=333&auth=')
  expect(item.url).not.toContain('/api/netease/url/')
  expect(item.pic).not.toContain('/api/netease/pic/')
  expect(item.lrc).not.toContain('/api/netease/lrc/')
})

test('createApp 非 GET 方法返回 404', async () => {
  const res = await createApp()(new Request('http://x/api', { method: 'POST' }))
  expect(res.status).toBe(404)
})
