import { test, expect } from 'bun:test'
import { auth } from '../src/service/auth.js'

test('auth 生成确定性的 HMAC-SHA1 token', () => {
  expect(auth('netease', 'url', '123', 'token')).toBe('463829e428bd90210d4bfe4f3d57bf8aace86736')
  expect(auth('netease', 'lrc', '123', 'token')).toBe('85c08d777d3d1a42c0cc455c6cd4b2f41ebb0a0a')
  expect(auth('tencent', 'pic', 'abc', 'token')).toBe('19e7755ed6d85e32892b1d5b02804a51f14dbc22')
})

test('auth 对不同输入产生不同结果', () => {
  expect(auth('netease', 'url', '123', 'token')).not.toBe(auth('netease', 'url', '124', 'token'))
  expect(auth('netease', 'url', '123', 'token')).not.toBe(auth('tencent', 'url', '123', 'token'))
})
