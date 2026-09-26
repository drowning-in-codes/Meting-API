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
