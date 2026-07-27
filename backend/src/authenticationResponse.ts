import { jsonResponse } from './utils'

const UNAUTHORIZED_MESSAGE = 'Unauthorized — missing or invalid Bearer token'

export function unauthorizedResponse(code = 'AUTHENTICATION_REQUIRED'): Response {
  const response = jsonResponse({
    error: {
      code,
      message: UNAUTHORIZED_MESSAGE,
    },
  }, 401)
  response.headers.set('WWW-Authenticate', 'Bearer realm="BestCode MCP"')
  response.headers.set('Cache-Control', 'no-store')
  return response
}
