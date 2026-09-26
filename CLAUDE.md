# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Meting-API 是一个多平台音乐 API 代理服务,封装了 @meting/core 库,支持网易云、腾讯、酷狗、百度、酷我等音乐平台的搜索、歌曲、专辑、歌手、歌单、歌词、URL 和封面图片获取。

## 常用命令

```bash
# 开发环境(Bun --watch 自动重启)
bun run dev

# 生产环境
bun run start

# 代码检查(oxlint)
bun run lint

# 单元测试
bun test

# Docker 构建与运行
docker build -t meting-api .
docker run -p 80:80 -e METING_URL=https://example.com -e METING_TOKEN=secret meting-api
```

单元测试位于 `test/` 目录(auth/lyric/router),使用 Bun 内置测试运行器。

## 技术栈

- **运行时**: Bun (ES Module)；Vercel 部署时为 Node.js Serverless Runtime（非 Edge）
- **HTTP 服务**: 原生 Bun.serve API（非框架），共享 handler 基于 Web 标准 `Request`/`Response`
- **核心库**: @meting/core ^1.6.0（音乐 API 封装）
- **缓存**: lru-cache ^11.x
- **日志**: pino（JSON 格式）+ pino-pretty（开发环境）
- **加密**: Node.js 内置 `node:crypto`（HMAC-SHA1）
- **代码检查**: oxlint（非 ESLint）

## 核心架构

### 请求处理链

入口 `src/index.js` 使用 Bun.serve 启动 HTTP/HTTPS 服务器（Vercel 部署时由 `api/` 下的函数作为入口）。中间件按函数组合模式串联：

```
Bun.serve / Vercel 函数 → CORS 处理 → logger 中间件 → error 中间件 → router → service
```

路由解析在 `src/router.js`（纯函数 parseRoute + route handler，非框架路由器），支持两种形式:
- 传统 `GET {prefix}/api?server=&type=&id=` → `src/service/api.js`（核心 API）
- RESTful `GET {prefix}/api/:server/search` / `GET {prefix}/api/:server/:type/:id` → 同上
- `GET {prefix}/demo` → `src/service/demo.js`（演示播放器页面）
- 其他 → 404

### 文件职责

| 文件 | 职责 |
|------|------|
| `src/index.js` | Bun 适配器:Bun.serve 启动 HTTP/HTTPS 服务器,复用共享 handler |
| `src/app.js` | 共享 handler:`createApp()` 组合 CORS + logger + error + router,兼容 Bun 与 Vercel |
| `src/router.js` | 路由解析:纯函数 `parseRoute`（路径→路由描述）与 `route` handler,支持传统与 RESTful 两种形式 |
| `src/config.js` | 环境变量解析为结构化配置对象 |
| `src/service/api.js` | 核心业务:参数校验→鉴权→缓存→调用上游API→URL转换→响应组装（导出 `resolve`） |
| `src/service/auth.js` | 鉴权:生成敏感接口（lrc/url/pic）的 HMAC-SHA1 token |
| `src/service/demo.js` | 返回嵌入 APlayer + Meting.js 的 HTML 演示页 |
| `api/index.js` | Vercel 入口（根路由） |
| `api/[...path].js` | Vercel 入口（catch-all 路由,兜底 RESTful 路径） |
| `src/middleware/logger.js` | 请求日志:生成 requestId,记录响应时间和状态码 |
| `src/middleware/errors.js` | 统一异常捕获,通过 `x-error-message` 响应头传递错误信息 |
| `src/utils/cookie.js` | Cookie 读取(环境变量优先,文件次之),5分钟缓存,referrer 白名单校验 |
| `src/utils/http-exception.js` | 自定义 HTTPException 类(status + message） |
| `src/utils/lyric.js` | LRC 歌词解析,原文与翻译按时间轴合并,格式: `原文 (翻译)` |

### 认证机制

敏感操作(lrc、url、pic)使用 HMAC-SHA1 token 认证:
- token 计算: `HMAC-SHA1(METING_TOKEN, "${server}${type}${id}")`
- auth 函数已抽取到 `src/service/auth.js`（由 `src/service/api.js` 引入调用）
- 认证参数通过查询字符串 `token` 或 `auth` 传递

### 缓存策略

LRU 缓存(lru-cache),最多 1000 条,默认 TTL 30 秒:
- url 类型: 10 分钟
- 其他类型: 1 小时
- 缓存未命中时设置 `x-cache: miss` 响应头

### URL 转换逻辑（`src/service/api.js:83-111`）

不同平台的音频 URL 需特殊处理:
- **网易云**: m7c/m8c → m7/m8,强制 HTTPS,移除 vuutv 参数
- **腾讯**: ws.stream → dl.stream,强制 HTTPS
- **百度**: zhangmenshiting.qianqian.com → gss3.baidu.com CDN

### Cookie 管理

Cookie 支持两种来源（优先级从高到低）:
1. 环境变量 `METING_COOKIE_{SERVER}`（如 `METING_COOKIE_NETEASE`）
2. 文件系统 `./cookie/{server}`

通过 `METING_COOKIE_ALLOW_HOSTS` 限制哪些 referrer 来源可使用 Cookie。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HTTP_PREFIX` | 路由前缀 | `` (空) |
| `HTTP_PORT` | HTTP 端口 | `80` |
| `HTTPS_ENABLED` | 启用 HTTPS | `false` |
| `HTTPS_PORT` | HTTPS 端口 | `443` |
| `SSL_KEY_PATH` | HTTPS 私钥路径 | - |
| `SSL_CERT_PATH` | HTTPS 证书路径 | - |
| `METING_URL` | 公网访问地址（用于生成回调 URL） | -（未设置时回退到 `https://${VERCEL_URL}`） |
| `VERCEL_URL` | Vercel 自动注入的域名 | -（仅 Vercel 环境存在） |
| `METING_TOKEN` | HMAC 签名密钥 | `token` |
| `METING_COOKIE_ALLOW_HOSTS` | Cookie referrer 白名单（逗号分隔） | `` (不限制) |
| `METING_COOKIE_{SERVER}` | 各平台 Cookie（NETEASE/TENCENT/KUGOU/BAIDU/KUWO） | - |

## 开发注意事项

### 版本发布
- 更新 package.json 中的 version，采用 Semantic Versioning
- 打 git tag vX.X.X

### 错误处理
- 使用 HTTPException 抛出 HTTP 错误（400/401/404/500）
- 错误中间件统一捕获,通过 `x-error-message` 响应头（URL 编码）传递错误信息
- 上游 API 错误分为调用失败和格式异常两类,均返回 500

### 参数验证
- server 参数白名单: netease/tencent/kugou/baidu/kuwo
- type 参数白名单: search/song/album/artist/playlist/lrc/url/pic
- 不合法参数返回 400

### 代码风格
- ES Module（`import/export`）
- 使用 async/await 处理异步
- 文件组织按职责分离：service / middleware / utils
