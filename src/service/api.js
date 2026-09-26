import Meting from '@meting/core'
import { HTTPException } from '../utils/http-exception.js'
import config from '../config.js'
import { format as lyricFormat } from '../utils/lyric.js'
import { readCookieFile, isAllowedHost } from '../utils/cookie.js'
import { auth } from './auth.js'
import { LRUCache } from 'lru-cache'

const cache = new LRUCache({
  max: 1000,
  ttl: 1000 * 30
})

const METING_METHODS = {
  search: 'search',
  song: 'song',
  album: 'album',
  artist: 'artist',
  playlist: 'playlist',
  lrc: 'lyric',
  url: 'url',
  pic: 'pic'
}

export async function resolve (request, ctx, { server, type, id, token }) {
  // 1. 校验参数
  if (!['netease', 'tencent', 'kugou', 'baidu', 'kuwo'].includes(server)) {
    throw new HTTPException(400, { message: 'server 参数不合法' })
  }
  if (!['song', 'album', 'search', 'artist', 'playlist', 'lrc', 'url', 'pic'].includes(type)) {
    throw new HTTPException(400, { message: 'type 参数不合法' })
  }

  // 2. 鉴权
  if (['lrc', 'url', 'pic'].includes(type)) {
    if (auth(server, type, id) !== token) {
      throw new HTTPException(401, { message: '鉴权失败,非法调用' })
    }
  }

  // 3. 调用 API(缓存)
  const cacheKey = `${server}/${type}/${id}`
  let data = cache.get(cacheKey)
  if (data === undefined) {
    ctx.responseHeaders.set('x-cache', 'miss')
    const meting = new Meting(server)
    meting.format(true)

    const referrer = request.headers.get('referer')
    if (isAllowedHost(referrer)) {
      const cookie = await readCookieFile(server)
      if (cookie) {
        meting.cookie(cookie)
      }
    }

    const method = METING_METHODS[type]
    let response
    try {
      response = await meting[method](id)
    } catch {
      throw new HTTPException(500, { message: '上游 API 调用失败' })
    }
    try {
      data = JSON.parse(response)
    } catch {
      throw new HTTPException(500, { message: '上游 API 返回格式异常' })
    }
    cache.set(cacheKey, data, {
      ttl: type === 'url' ? 1000 * 60 * 10 : 1000 * 60 * 60
    })
  }

  // 4. 组装结果
  if (type === 'url') {
    let url = data.url
    if (!url) {
      return new Response(null, { status: 404 })
    }
    if (server === 'netease') {
      url = url
        .replace('://m7c.', '://m7.')
        .replace('://m8c.', '://m8.')
        .replace('http://', 'https://')
      if (url.includes('vuutv=')) {
        const tempUrl = new URL(url)
        tempUrl.search = ''
        url = tempUrl.toString()
      }
    }
    if (server === 'tencent') {
      url = url
        .replace('http://', 'https://')
        .replace('://ws.stream.qqmusic.qq.com', '://dl.stream.qqmusic.qq.com')
    }
    if (server === 'baidu') {
      url = url
        .replace('http://zhangmenshiting.qianqian.com', 'https://gss3.baidu.com/y0s1hSulBw92lNKgpU_Z2jR7b2w6buu')
    }
    return new Response(null, {
      status: 302,
      headers: { location: url, 'cache-control': 'public, max-age=600' }
    })
  }

  if (type === 'pic') {
    const url = data.url
    if (!url) {
      return new Response(null, { status: 404 })
    }
    return new Response(null, {
      status: 302,
      headers: { location: url, 'cache-control': 'public, max-age=600' }
    })
  }

  if (type === 'lrc') {
    return new Response(lyricFormat(data.lyric, data.tlyric || ''), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600'
      }
    })
  }

  return Response.json(data.map(x => {
    return {
      title: x.name,
      author: x.artist.join(' / '),
      url: `${config.meting.url}/api?server=${server}&type=url&id=${x.url_id}&auth=${auth(server, 'url', x.url_id)}`,
      pic: `${config.meting.url}/api?server=${server}&type=pic&id=${x.pic_id}&auth=${auth(server, 'pic', x.pic_id)}`,
      lrc: `${config.meting.url}/api?server=${server}&type=lrc&id=${x.lyric_id}&auth=${auth(server, 'lrc', x.lyric_id)}`
    }
  }), {
    headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' }
  })
}
