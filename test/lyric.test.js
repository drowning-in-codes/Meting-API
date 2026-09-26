import { test, expect } from 'bun:test'
import { format } from '../src/utils/lyric.js'

test('format 合并原文与翻译', () => {
  const lyric = '[00:00.000]第一句\n[00:05.000]第二句'
  const tlyric = '[00:00.000]First\n[00:05.000]Second'
  expect(format(lyric, tlyric)).toBe('[00:00.000]第一句 (First)\n[00:05.000]第二句 (Second)')
})

test('format 无翻译时原样返回原文', () => {
  const lyric = '[00:00.000]第一句\n[00:05.000]第二句'
  expect(format(lyric, '')).toBe(lyric)
})
