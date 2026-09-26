# Vercel 部署 + RESTful 改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Meting-API 从「Bun 常驻进程 + 查询串接口」改造为「框架无关核心 + Bun/Vercel 双适配 + RESTful 主接口(保留 legacy 向后兼容)」。

**Architecture:** 抽取 Web 标准 `Request → Response` 的共享 handler(`src/app.js`),组合 CORS + logger + error + router;`src/index.js`(Bun)和 `api/*.js`(Vercel)分别作为薄适配器调用它。路由层 `src/router.js` 同时解析 RESTful 路径与 legacy 查询串,统一收敛到 `resolve({server,type,id,token})`。

**Tech Stack:** Bun(本地)、Vercel Node.js Serverless Functions、`@meting/core`、`lru-cache`、`pino`、`bun:test`。

**Spec:** `docs/superpowers/specs/2026-09-27-vercel-restful-migration-design.md`

## Global Constraints

- `server` 白名单:`netease/tencent/kugou/baidu/kuwo`
- `type` 白名单:`song/album/search/artist/playlist/lrc/url/pic`
- HMAC-SHA1 公式:`HMAC-SHA1(METING_TOKEN, "${server}${type}${id}")`,token 默认 `'token'`
- 返回格式、状态码、`x-error-message`/`x-cache` 头行为不变
- **列表响应中的 `url`/`pic`/`lrc` 回调 URL 保持 legacy 格式**(`/api?server=&type=&id=&auth=`),不得改成 RESTful,否则破坏 Meting.js
- Vercel 用 Node.js Serverless Runtime(非 Edge)
- 双适配:Bun 本地 + Vercel,共享核心逻辑

---

### Task 1: 抽取 `auth` 为可测纯函数并加测试

**Files:**
- Create: `src/service/auth.js`
- Modify: `src/service/api.js:139-141`(删除底部 `auth` 定义,改为 import)
- Test: `test/auth.test.js`
- Modify: `package.json`(加 `test` script)

**Interfaces:**
- Produces: `auth(server, type, id, secret = config.meting.token) -> string`(HMAC-SHA1 hex,40 字符)。`secret` 可选,默认取 `config.meting.token`,供测试传固定值。

- [ ] **Step 1: 写失败测试**

```js
// test/auth.test.js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/auth.test.js`
Expected: FAIL,报 `Cannot find module '../src/service/auth.js'`

- [ ] **Step 3: 创建 `src/service/auth.js`**

```js
import { createHmac } from 'node:crypto'
import config from '../config.js'

/**
 * 生成敏感接口(lrc/url/pic)的 HMAC-SHA1 鉴权 token
 * @param {string} server 平台名
 * @param {string} type 操作类型
 * @param {string} id 资源 ID
 * @param {string} [secret] 签名密钥,默认取配置 METING_TOKEN
 * @returns {string} hex token
 */
export function auth (server, type, id, secret = config.meting.token) {
  return createHmac('sha1', secret).update(`${server}${type}${id}`).digest('hex')
}
```

- [ ] **Step 4: 修改 `src/service/api.js` 引用 auth**

在 `api.js` 顶部 import 区加入 `import { auth } from './auth.js'`,删除第 2 行的 `import { createHmac } from 'node:crypto'`(不再使用),并删除文件底部第 139-141 行的 `auth` 定义(第 131-136 行对 `auth(...)` 的调用保持不动)。

- [ ] **Step 5: 加 `test` script 到 package.json**

```json
"scripts": {
  "start": "bun run src/index.js",
  "dev": "bun --watch run src/index.js",
  "test": "bun test",
  "lint": "oxlint ."
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test test/auth.test.js`
Expected: PASS(2 个测试)

- [ ] **Step 7: 提交**

```bash
git add src/service/auth.js src/service/api.js test/auth.test.js package.json
git commit -m "refactor: 抽取 auth 为可测纯函数并加单测"
```

---

### Task 2: 新增 `parseRoute` 纯路由解析器并加测试

**Files:**
- Create: `src/router.js`(本任务只加 `parseRoute`,`route()` 在 Task 4 加)
- Test: `test/router.test.js`

**Interfaces:**
- Produces: `parseRoute(pathname, prefix = config.http.prefix) -> { kind, server?, type?, id? }`,`kind ∈ { legacy, search, resource, demo, notfound }`。

- [ ] **Step 1: 写失败测试**

```js
// test/router.test.js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/router.test.js`
Expected: FAIL,报 `Cannot find module '../src/router.js'`

- [ ] **Step 3: 创建 `src/router.js`(仅 parseRoute)**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test test/router.test.js`
Expected: PASS(5 个测试)

- [ ] **Step 5: 提交**

```bash
git add src/router.js test/router.test.js
git commit -m "feat: 新增 parseRoute 纯路由解析器并加单测"
```

---

### Task 3: 为 `lyric.js` 加单测

**Files:**
- Test: `test/lyric.test.js`

**Interfaces:**
- Consumes: `format(lyric, tlyric) -> string`(已存在,`src/utils/lyric.js`)

- [ ] **Step 1: 写测试**

```js
// test/lyric.test.js
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
```

- [ ] **Step 2: 运行测试确认通过**

Run: `bun test test/lyric.test.js`
Expected: PASS(2 个测试)

- [ ] **Step 3: 提交**

```bash
git add test/lyric.test.js
git commit -m "test: 为 lyric.js 加单测"
```

---

### Task 4: 核心重构 —— Bun 适配到共享 handler

**Files:**
- Modify: `src/service/api.js`(默认导出 `(request, ctx)` → 具名 `resolve(request, ctx, params)`;加 Cache-Control)
- Modify: `src/router.js`(补上 `route(request, ctx)`)
- Create: `src/app.js`
- Modify: `src/index.js`(改用 `createApp()`)

**Interfaces:**
- Consumes: `auth`(Task 1)、`parseRoute`(Task 2)
- Produces: `resolve(request, ctx, { server, type, id, token }) -> Response`;`route(request, ctx) -> Response`;`createApp() -> async (request) => Response`

- [ ] **Step 1: 重写 `src/service/api.js`**

将文件整体替换为以下内容(参数解析移到 router,`resolve` 只接收已解析的 `{server,type,id,token}`;列表回调 URL 保持 legacy 格式;各响应加 `Cache-Control`):

```js
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
```

- [ ] **Step 2: 在 `src/router.js` 补上 `route()`**

在 `parseRoute` 之后追加:

```js
import { resolve } from './service/api.js'
import demoService from './service/demo.js'

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
```

注意:`router.js` 顶部 import 区当前只有 `import config from './config.js'`,需保持并在其下追加上述两个 import(ES Module 的 import 必须放文件顶部,合并为一份 import 块)。

- [ ] **Step 3: 创建 `src/app.js`**

```js
import { withRequestLogger } from './middleware/logger.js'
import { withErrorHandler } from './middleware/errors.js'
import { route } from './router.js'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'access-control-max-age': '86400'
}

function addCorsHeaders (response) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export function createApp () {
  const handler = withRequestLogger(withErrorHandler(route))
  return async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    return addCorsHeaders(await handler(request))
  }
}
```

- [ ] **Step 4: 重写 `src/index.js`(Bun 适配器)**

```js
import { readFileSync } from 'node:fs'
import { logger } from './middleware/logger.js'
import { createApp } from './app.js'
import config from './config.js'

const app = createApp()

Bun.serve({
  port: config.http.port,
  fetch: app
})

logger.info({ port: config.http.port }, 'HTTP server started')

if (config.https.enabled) {
  if (!config.https.keyPath || !config.https.certPath) {
    logger.error('HTTPS_ENABLED is true but SSL_KEY_PATH or SSL_CERT_PATH is not configured')
    process.exit(1)
  }

  let key
  let cert

  try {
    key = readFileSync(config.https.keyPath)
    cert = readFileSync(config.https.certPath)
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to read SSL certificate files')
    process.exit(1)
  }

  Bun.serve({
    port: config.https.port,
    tls: { key, cert },
    fetch: app
  })

  logger.info({ port: config.https.port }, 'HTTPS server started')
} else {
  logger.info('HTTPS server is disabled')
}
```

- [ ] **Step 5: 冒烟验证 Bun 服务**

在终端 1 启动:`bun run dev`
在终端 2 验证(注意替换 `<url_id>` 为实际值):

```bash
# legacy 仍可用
curl -s "http://localhost:80/api?server=netease&type=search&id=周杰伦" | head -c 200
# RESTful 资源
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:80/api/netease/search?keywords=周杰伦"
# RESTful 带鉴权(先算 token,或直接测 401 分支)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:80/api/netease/url/xxx"
# demo 页
curl -s "http://localhost:80/demo" | head -c 100
```

Expected:
- legacy search 返回 JSON 数组(200)
- RESTful search 返回 200
- RESTful url 不带正确 token 返回 401(或带 token 返回 302)
- demo 返回 HTML

- [ ] **Step 6: 运行全部测试确认无回归**

Run: `bun test`
Expected: 全部 PASS(9 个测试)

- [ ] **Step 7: 提交**

```bash
git add src/service/api.js src/router.js src/app.js src/index.js
git commit -m "refactor: 抽取共享 handler,Bun 适配器改用 createApp,新增 RESTful 路由"
```

---

### Task 5: Vercel 适配层

**Files:**
- Create: `api/index.js`
- Create: `api/[...path].js`
- Create: `vercel.json`
- Modify: `src/config.js`(`meting.url` 支持 VERCEL_URL 默认)
- Modify: `src/utils/cookie.js`(serverless 环境下跳过文件监听/读取)

**Interfaces:**
- Consumes: `createApp`(Task 4)
- Produces: Vercel 函数入口导出 `GET`/`OPTIONS`(Web 标准签名)

- [ ] **Step 1: 创建 `api/index.js`**

```js
import { createApp } from '../src/app.js'

const app = createApp()

export const GET = app
export const OPTIONS = app
```

- [ ] **Step 2: 创建 `api/[...path].js`**

```js
import { createApp } from '../src/app.js'

const app = createApp()

export const GET = app
export const OPTIONS = app
```

- [ ] **Step 3: 创建 `vercel.json`**

```json
{
  "rewrites": [
    { "source": "/demo", "destination": "/api/demo" }
  ]
}
```

- [ ] **Step 4: 修改 `src/config.js`**

将 `meting.url` 一行改为:

```js
url: process.env.METING_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''),
```

- [ ] **Step 5: 修改 `src/utils/cookie.js`**

在顶部 `const COOKIE_TTL = ...` 之后加一行:

```js
const isServerless = process.env.VERCEL === '1'
```

把文件底部的监听启动块:

```js
if (!watcher) {
  startWatcher().catch(() => {})
}
```

改为:

```js
if (!isServerless && !watcher) {
  startWatcher().catch(() => {})
}
```

并在 `readCookieFile` 内、环境变量判断 `if (envCookie) {...}` 之后、文件读取之前,插入 serverless 短路:

```js
if (isServerless) {
  cookieCache.set(server, { value: '', timestamp: now })
  return ''
}
```

- [ ] **Step 6: 本地语法/打包冒烟(无需登录)**

Run: `bun run lint`
Expected: 0 errors(如 oxlint 对 `api/*.js` 的 `process.env.VERCEL` 无意见)

- [ ] **Step 7: 提交**

```bash
git add api/index.js "api/[...path].js" vercel.json src/config.js src/utils/cookie.js
git commit -m "feat: 新增 Vercel serverless 适配层"
```

> 说明:Vercel 上真正的运行时验证需 `vercel dev` 或部署(Vercel CLI + 登录)。本任务交付后由用户自行 `vercel` 部署,或后续单独验证。

---

### Task 6: 文档更新

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** 无(纯文档)

- [ ] **Step 1: 更新 `README.md`**

具体改动:
1. 顶部「基于 Hono.js」改为「基于原生 Web 标准 Request/Response,可同时部署为 Bun 常驻进程或 Vercel Serverless 函数」;特性列表加「☁️ Vercel 一键部署」。
2. 把 `yarn install` / `yarn dev` / `yarn start` 改为 `bun install` / `bun run dev` / `bun run start`。
3. 在「API 接口文档」章节新增「RESTful 接口」小节,列出:
   ```
   GET /api/:server/search?keywords=xxx
   GET /api/:server/song/:id
   GET /api/:server/album/:id
   GET /api/:server/artist/:id
   GET /api/:server/playlist/:id
   GET /api/:server/lrc/:id   (需 token)
   GET /api/:server/url/:id    (需 token)
   GET /api/:server/pic/:id    (需 token)
   ```
   并说明 legacy `/api?server=&type=&id=` 仍可用。
4. 新增「Vercel 部署」小节:说明 `api/` 目录自动识别为 Serverless Functions,需设置环境变量 `METING_TOKEN`(可选 `METING_URL`,未设时自动取 Vercel 域名)。
5. 技术栈一节把「运行时 Node.js 22+ / Hono / hash.js」改为「Bun + Vercel Node.js Runtime / 原生 fetch API / node:crypto」。
6. 「开发」一节把「ESLint Standard / yarn lint」改为「oxlint / bun run lint」。

- [ ] **Step 2: 更新 `CLAUDE.md`**

具体改动:
1. 「核心架构」请求处理链图更新为 `Bun.serve / Vercel 函数 → CORS → logger → error → router → service`。
2. 「文件职责」表新增 `src/app.js`(共享 handler)、`src/router.js`(路由解析)、`src/service/auth.js`(鉴权)、`api/*.js`(Vercel 入口),并更新 `src/index.js` 职责为「Bun 适配器」。
3. 「认证机制」补充 auth 已抽到 `src/service/auth.js`。
4. 「环境变量」表新增 `VERCEL_URL`(Vercel 自动注入)说明,并注明 `METING_URL` 未设时回退到它。
5. 「常用命令」补 `bun test`。

- [ ] **Step 3: 提交**

```bash
git add README.md CLAUDE.md
git commit -m "docs: 更新 README 与 CLAUDE.md 反映双适配与 RESTful 接口"
```

---

### Task 7: 最终验证

**Files:** 无新增(仅验证)

- [ ] **Step 1: 代码检查**

Run: `bun run lint`
Expected: 0 errors

- [ ] **Step 2: 全量测试**

Run: `bun test`
Expected: 全部 PASS(9 个测试)

- [ ] **Step 3: 完整冒烟(重启 Bun)**

Run: `bun run dev` 后依次:
```bash
curl -s "http://localhost:80/api?server=netease&type=search&id=周杰伦" | head -c 200
curl -s "http://localhost:80/api/netease/search?keywords=周杰伦" | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:80/api/netease/url/xxx"
curl -s "http://localhost:80/demo" | head -c 100
```
Expected:legacy 与 RESTful 均返回 200 JSON;url 无 token 返回 401;demo 返回 HTML。

- [ ] **Step 4: 检查 git 状态与提交遗漏**

Run: `git status`
Expected: 无未提交改动(或仅剩用户预期的文件)

---

## 执行备注

- 全部任务提交后可选择 `superpowers:subagent-driven-development`(逐任务派发子代理 + 审查)或 `superpowers:executing-plans`(本会话内批量执行 + 检查点)。
- Vercel 运行时部署验证(Vercel CLI 登录、`vercel dev`、正式部署)需要用户账号,不在本计划内自动完成;Task 5 已把该验证标记为「交付后由用户执行」。
- 若 Vercel 安装依赖时对 `bun.lock` 有异议,可在 `vercel.json` 加 `"installCommand": "npm install"` 或提交 `package-lock.json` 解决(本计划默认不处理)。
