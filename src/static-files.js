/**
 * Arquivos estaticos do console (`web/`), servidos por NOME.
 *
 * O mapa rota -> arquivo nasce da propria pasta no arranque; a URL so serve de
 * chave de busca, nunca vira caminho de disco (`..` nao chega a lugar nenhum).
 * Todo arquivo sai com ETag e `no-cache`: o navegador revalida com um 304 barato
 * e um deploy novo aparece na proxima abertura. So os icones ficam em cache.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
/** O manifesto tem tipo proprio (os navegadores aceitam `application/json`, mas este e o registrado). */
const TYPE_OF_ROUTE = { '/manifest.json': 'application/manifest+json' }
/** Paginas que existem so pelo apelido: `/` e `/chat` (nunca `/index.html`). */
const PAGE_ALIASES = { '/': 'index.html', '/chat': 'chat.html' }
/** Rotas de tela do app: o mesmo index.html, o JS decide o que mostrar pelo pathname. */
const SHELL_ROUTES = /^\/(?:card\/[^/]+|fluxo|board|editar|controle|metricas|historico|pending|search)$/
const ICON_MAX_AGE_S = 86_400

function walk(dir, prefix = '') {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), rel))
    else if (TYPES[extensionOf(entry.name)]) found.push(rel)
  }
  return found
}

const extensionOf = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.')) : '')

export function createStaticFiles({ webDir }) {
  const routes = new Map()
  for (const rel of walk(webDir)) {
    if (rel === 'index.html' || rel === 'chat.html') continue
    routes.set(`/${rel}`, rel)
  }

  /** O que o service worker guarda para abrir sem rede: paginas, css, js e icones; nao o app.js do desktop nem o proprio sw.js. */
  function precacheList() {
    const skip = new Set(['/sw.js', '/app.js', '/icons/icon.svg'])
    return ['/', '/chat', ...[...routes.keys()].filter((route) => !skip.has(route))].sort()
  }

  /** Muda quando qualquer arquivo de `web/` muda: e o que faz o service worker se atualizar. */
  function buildId() {
    const parts = [...routes.values(), ...Object.values(PAGE_ALIASES)].sort().map((rel) => {
      const s = statSync(join(webDir, rel))
      return `${rel}:${s.size}:${s.mtimeMs}`
    })
    return createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 12)
  }

  function send(req, res, rota, rel) {
    const full = join(webDir, rel)
    let stat
    let body
    try {
      stat = statSync(full)
      body = readFileSync(full)
    } catch {
      res.writeHead(404)
      return res.end()
    }
    let etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`
    if (rel === 'sw.js') {
      const id = buildId()
      body = Buffer.from(body.toString('utf8').replaceAll('__BUILD__', id).replaceAll('__ASSETS__', JSON.stringify(precacheList())))
      etag = `W/"sw-${id}"`
    }
    const headers = {
      'content-type': TYPE_OF_ROUTE[rota] ?? TYPES[extensionOf(rel)],
      etag,
      'cache-control': rota.startsWith('/icons/') ? `public, max-age=${ICON_MAX_AGE_S}` : 'no-cache',
      'x-content-type-options': 'nosniff',
    }
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': headers['cache-control'] })
      return res.end()
    }
    res.writeHead(200, { ...headers, 'content-length': body.length })
    return res.end(req.method === 'HEAD' ? undefined : body)
  }

  /** `true` quando a rota e daqui (a resposta ja foi escrita). */
  function handle(req, res, rota) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    const rel = PAGE_ALIASES[rota] ?? (SHELL_ROUTES.test(rota) ? 'index.html' : routes.get(rota))
    if (!rel) return false
    send(req, res, rota, rel)
    return true
  }

  return { handle, buildId }
}
