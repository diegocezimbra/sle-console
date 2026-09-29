// Service worker do SLE Console (CARD-094): abre o app sem rede, mostra o ultimo estado e recebe push.
//
// O servidor troca __BUILD__ e __ASSETS__ a cada requisicao: o id muda quando QUALQUER arquivo de web/
// muda, entao o navegador ve um sw.js diferente, instala a versao nova e apaga o cache da antiga.
const BUILD = '__BUILD__'
const ASSETS = __ASSETS__
const SHELL_CACHE = `sle-shell-${BUILD}`
const DATA_CACHE = 'sle-data-v1'
const ASSET_SET = new Set(ASSETS)
const MAX_DATA_ENTRIES = 80
const NETWORK_TIMEOUT_MS = 4000
/** Leituras que ficam guardadas para o modo sem rede. Credenciais e imagens do chat nunca entram. */
const DATA_ROUTES = /^\/api\/(cards|search|chat|projetos)(\/|$)/
const NEVER_CACHE = /\/credentials$|^\/api\/chat\/anexos\/|^\/api\/chat\/attachments$/

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    // Um asset que falhe (401 antes do login, rede ruim) nao derruba a instalacao: entra na proxima visita.
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }))
        if (response.ok) await cache.put(url, response)
      } catch { /* segue */ }
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('sle-shell-') && key !== SHELL_CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
const fromNetwork = (request) => Promise.race([fetch(request), timeout(NETWORK_TIMEOUT_MS)])

/** Toda tela do app e o mesmo index.html; o chat e a outra pagina. Rede primeiro, cache se a rede falhar. */
async function navigation(request, url) {
  const key = url.pathname === '/chat' ? '/chat' : '/'
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fromNetwork(request)
    if (response.ok) await cache.put(key, response.clone())
    return response
  } catch {
    return (await cache.match(key)) ?? Response.error()
  }
}

/** Assets versionados pelo proprio sw.js: o cache da versao e a verdade, entao cache primeiro. */
async function asset(request, url) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(url.pathname)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(url.pathname, response.clone())
  return response
}

/** A resposta guardada perde `content-encoding`: o corpo ja foi decodificado, e reenviar o cabecalho corromperia a leitura. */
async function snapshot(response) {
  const headers = new Headers({ 'content-type': response.headers.get('content-type') ?? 'application/json', 'x-sle-cached-at': new Date().toISOString() })
  return new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers })
}

/** Leituras: rede primeiro (dado fresco), e sem rede o ultimo que deu certo, marcado com `x-sle-offline` para a tela avisar. */
async function data(request) {
  const cache = await caches.open(DATA_CACHE)
  try {
    const response = await fromNetwork(request)
    if (response.ok) {
      await cache.put(request.url, await snapshot(response))
      const keys = await cache.keys()
      if (keys.length > MAX_DATA_ENTRIES) await cache.delete(keys[0])
    }
    return response
  } catch {
    const cached = await cache.match(request.url)
    if (!cached) return Response.error()
    const headers = new Headers(cached.headers)
    headers.set('x-sle-offline', '1')
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers })
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') return event.respondWith(navigation(request, url))
  if (DATA_ROUTES.test(url.pathname) && !NEVER_CACHE.test(url.pathname)) return event.respondWith(data(request))
  if (ASSET_SET.has(url.pathname)) return event.respondWith(asset(request, url))
})

// Push (o disparo e do CARD-240): payload JSON {title, body, url, tag}. `tag` troca a notificacao anterior em vez de empilhar.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'SLE Console', {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,
    renotify: Boolean(payload.tag),
    data: { url: payload.url || '/pending' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // So links do proprio console: um payload nao abre site de fora.
  let target = new URL('/pending', self.location.origin)
  try {
    const wanted = new URL(event.notification.data?.url || '/pending', self.location.origin)
    if (wanted.origin === self.location.origin) target = wanted
  } catch { /* fica no /pending */ }
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = open.find((c) => 'focus' in c)
    if (client) {
      await client.focus()
      if ('navigate' in client) await client.navigate(target.href).catch(() => {})
      return
    }
    await self.clients.openWindow(target.href)
  })())
})
