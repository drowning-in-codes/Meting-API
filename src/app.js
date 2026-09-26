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
