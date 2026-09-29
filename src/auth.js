/**
 * Basic auth middleware for the console.
 *
 * Applies to every route (pages and `/api/*`) whenever both `CONSOLE_USER`
 * and `CONSOLE_PASSWORD` are set. If either is missing, auth is skipped
 * entirely (local mode) -- so `sle` keeps working with zero setup on a dev
 * machine, and only the cloud deploy (which sets both envs) is gated.
 */
import { timingSafeEqual } from 'node:crypto'

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  // Different lengths would short-circuit `timingSafeEqual`; hash both to a
  // fixed size first so a wrong-length guess costs the same as a right one.
  if (bufA.length !== bufB.length) {
    const paddedA = Buffer.alloc(64)
    const paddedB = Buffer.alloc(64)
    bufA.copy(paddedA)
    bufB.copy(paddedB)
    timingSafeEqual(paddedA, paddedB)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/**
 * Reads credentials from `env` (defaults to `process.env`) once, at daemon
 * startup, so the check per request is cheap and the mode (on/off) is fixed
 * for the lifetime of the process.
 */
/**
 * Arquivos que o navegador busca SEM credencial: o manifesto (`<link rel=manifest>` usa credentials=omit),
 * o service worker e os icones (o iOS busca o apple-touch-icon sozinho). Sao estaticos, sem dado nenhum.
 */
const PUBLIC_PATHS = new Set(['/manifest.json', '/sw.js'])
const isPublic = (url) => {
  const path = String(url ?? '').split('?')[0]
  return PUBLIC_PATHS.has(path) || (path.startsWith('/icons/') && !path.includes('..'))
}

export function createAuthMiddleware(env = process.env) {
  const user = env.CONSOLE_USER
  const password = env.CONSOLE_PASSWORD
  const enabled = Boolean(user) && Boolean(password)

  /**
   * Returns `true` when the request is authorized and the caller should
   * proceed. Returns `false` after already writing a 401 response.
   */
  return function authorize(req, res) {
    if (!enabled || isPublic(req.url)) return true

    const header = req.headers.authorization ?? ''
    const [scheme, encoded] = header.split(' ')
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8')
      const sep = decoded.indexOf(':')
      if (sep !== -1) {
        const givenUser = decoded.slice(0, sep)
        const givenPassword = decoded.slice(sep + 1)
        if (constantTimeEqual(givenUser, user) && constantTimeEqual(givenPassword, password)) {
          return true
        }
      }
    }

    res.writeHead(401, {
      'www-authenticate': 'Basic realm="sle-console"',
      'content-type': 'application/json; charset=utf-8',
    })
    res.end(JSON.stringify({ erro: 'autenticacao necessaria' }))
    return false
  }
}
