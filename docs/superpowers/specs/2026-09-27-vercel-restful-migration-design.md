# Vercel 部署 + RESTful 改造设计

- 日期:2026-09-27
- 状态:待用户 review
- 分支:`feat/proanimer`

## 背景与目标

Meting-API 当前是 Bun 常驻进程服务(原生 `Bun.serve`),接口为查询串风格
`GET /api?server=&type=&id=&auth=`。本次改造要达成两个目标:

1. **方便 Vercel 部署**:把请求处理逻辑抽成框架无关的核心,使项目既能以
   Bun 常驻进程运行(本地 `bun run dev` / Docker),也能作为 Vercel
   Serverless 函数部署。
2. **RESTful 风格**:新增基于路径的 RESTful 接口作为主接口,同时保留旧查询串
   接口向后兼容。

## 已确认的关键决策

1. **API 形态**:RESTful 为主 + 保留旧接口。demo 页与 Meting.js 继续使用旧
   查询串接口,无需改动。
2. **部署目标**:双适配 —— 共享核心逻辑,同时提供 Bun 入口与 Vercel 函数
   入口。不采用纯 Vercel 重写,也不重新引入 Hono。

## 目标架构

```
src/
  app.js                 # 新增:createApp() → (Request) => Response,组合 CORS+logger+error+router
  router.js              # 新增:路由解析(RESTful 路径 + legacy 查询串)
  index.js               # 保留:Bun 入口(Bun.serve + HTTPS)
  service/api.js         # 改造:抽出纯函数 resolve({server,type,id}),路由与业务解耦
  service/demo.js        # 保留
  middleware/logger.js   # 保留(Web 标准 API)
  middleware/errors.js   # 保留
  utils/cookie.js        # 条件化:文件读取+fs.watch 仅在非 Vercel 环境启用
  utils/http-exception.js# 保留
  utils/lyric.js         # 保留
api/
  [...path].js           # 新增:Vercel catch-all 函数
vercel.json              # 新增:路由 rewrite 配置
```

### 数据流

```
请求(Request, Web 标准)
  → CORS → logger 中间件 → error 中间件 → router
    → RESTful 路径解析 或 legacy 查询串解析 → {server, type, id, token}
    → service/api.resolve(server, type, id) → 鉴权 → 缓存 → 调 @meting/core → URL 转换
    → 组装 Response
```

核心 `resolve` 函数对 Bun 与 Vercel 两端完全一致,仅入口适配器不同。

## RESTful 路由设计(新主接口)

```
GET /api/:server/search?keywords=周杰伦      # 搜索(关键词走 keywords 查询参数)
GET /api/:server/song/:id
GET /api/:server/album/:id
GET /api/:server/artist/:id
GET /api/:server/playlist/:id
GET /api/:server/lrc/:id     # 需鉴权
GET /api/:server/url/:id     # 需鉴权
GET /api/:server/pic/:id     # 需鉴权
```

设计要点:

- `server` 白名单:`netease/tencent/kugou/baidu/kuwo`
- `search` 的关键词从 `id` 参数改名为 `keywords`(路径语义更清晰)
- `lrc/url/pic` 保持扁平 `/api/:server/url/:id`,**不做** `/song/:id/url`
  嵌套 —— 因为这三类资源使用的是 `x.lyric_id / x.url_id / x.pic_id`,
  与歌曲 `id` 不同,嵌套在语义上是错的
- 鉴权仍走 `?token=` / `?auth=` 查询参数,HMAC-SHA1 公式不变:
  `HMAC-SHA1(METING_TOKEN, "${server}${type}${id}")`
- 返回格式、状态码、`x-error-message` / `x-cache` 响应头行为不变

### legacy 接口(向后兼容,原样保留)

```
GET /api?server=&type=&id=&auth=
```

demo 页与 Meting.js 依赖此格式,保持不变。

## Vercel 适配

- **运行时**:Node.js Serverless Functions(默认),**不用** Edge Runtime
  (`node:crypto` 与 `@meting/core` 依赖 Node API)。
- **入口**:单个 `api/[...path].js` catch-all,复用同一份 `handle(request)`。
- **路由**:`vercel.json` 将 `/api/*` 与 `/demo` 转发到该函数。
- **环境变量**:`METING_TOKEN`、`METING_URL`(未设置时默认
  `https://${VERCEL_URL}`)、`METING_COOKIE_*`。

> 实现细节:Vercel Node.js 函数确切的 handler 签名(Web 标准
> `Request → Response`,还是 `@vercel/node` 的 `(req, res)`)需在写代码前
> 对照 Vercel 当前文档核实,据此决定 `api/[...path].js` 适配垫片的写法。
> 不影响整体设计。

## Vercel 不兼容处置

| 现状问题 | 处置 |
|---------|------|
| 内存 LRU(冷启动/多实例间不共享) | 保留(对 Bun 有意义;Vercel 每个热实例内也有效,无害);另给 `url`/`pic`/列表响应加 `Cache-Control` 头,让 Vercel CDN 边缘缓存 |
| `fs.watch` + `cookie/` 文件读取 | 条件化:仅在非 Vercel 环境启用文件读取与监听;Vercel 上只走 `METING_COOKIE_*` 环境变量 |
| `pino-pretty` transport(fork 子进程) | 现有代码已是「非生产才用 pretty」,Vercel 生产自动走纯 JSON stdout,基本无需改 |

## 其他

- CORS 抽进共享 handler,两端统一
- HTTPS / HTTP 端口仅 Bun 路径保留;Vercel 由平台托管 TLS
- `HTTP_PREFIX`:Bun 继续支持;Vercel 用 `vercel.json` 处理
- README 同步更新(现有 README 已过期,仍写着 Hono / yarn)

## 测试

项目目前无测试套件。本次改造:

1. 本地 `bun run dev` 冒烟验证:RESTful 路由、legacy 路由、demo 页
2. 为 `auth`、路由解析、`lyric.js` 增加轻量单测(`bun test`)

## 范围外(Out of scope)

- 不重新引入框架(Hono / Express 等)
- 不做 Edge Runtime 版本
- 不改变 @meting/core 的调用方式与上游数据格式
- 不新增平台或 type
