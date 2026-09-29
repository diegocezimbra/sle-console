import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStaticFiles } from '../src/static-files.js'

let web, server, base, files

const put = (rel, content) => {
  mkdirSync(join(web, rel, '..'), { recursive: true })
  writeFileSync(join(web, rel), content)
}

before(async () => {
  web = mkdtempSync(join(tmpdir(), 'sle-web-'))
  put('index.html', '<!doctype html><title>shell</title>')
  put('chat.html', '<!doctype html><title>chat</title>')
  put('app.js', 'export const a = 1')
  put('mobile/shell.js', 'export const s = 1')
  put('mobile/mobile.css', 'body{}')
  put('manifest.json', '{"name":"x"}')
  put('sw.js', "const BUILD = '__BUILD__'\nconst ASSETS = __ASSETS__")
  put('icons/icon-192.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  put('.escondido', 'nao serve')
  put('LEIAME.md', 'nao serve')
  files = createStaticFiles({ webDir: web })
  server = createServer((req, res) => {
    const rota = req.url.split('?')[0]
    if (!files.handle(req, res, rota)) { res.writeHead(404); res.end('nada') }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => new Promise((r) => (server.closeAllConnections(), server.close(r))))

test('/ e /chat servem as paginas por nome; /index.html e /chat.html nao existem', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /shell/)
  assert.match(await (await fetch(`${base}/chat`)).text(), /chat/)
  assert.equal((await fetch(`${base}/index.html`)).status, 404)
  assert.equal((await fetch(`${base}/chat.html`)).status, 404)
})

test('rotas do app (card, abas, mobile) devolvem o mesmo index.html', async () => {
  for (const rota of ['/card/CARD-1', '/board', '/pending', '/search', '/fluxo']) {
    const r = await fetch(base + rota)
    assert.equal(r.status, 200, rota)
    assert.match(await r.text(), /shell/, rota)
  }
})

test('cada arquivo sai com o tipo certo (js, css, json, png)', async () => {
  const tipo = async (rota) => (await fetch(base + rota)).headers.get('content-type')
  assert.equal(await tipo('/app.js'), 'text/javascript; charset=utf-8')
  assert.equal(await tipo('/mobile/shell.js'), 'text/javascript; charset=utf-8')
  assert.equal(await tipo('/mobile/mobile.css'), 'text/css; charset=utf-8')
  assert.equal(await tipo('/manifest.json'), 'application/manifest+json')
  assert.equal(await tipo('/icons/icon-192.png'), 'image/png')
})

test('arquivo oculto, markdown e caminho fora de web/ nao sao servidos', async () => {
  assert.equal((await fetch(`${base}/.escondido`)).status, 404)
  assert.equal((await fetch(`${base}/LEIAME.md`)).status, 404)
  assert.equal((await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).status, 404)
  assert.equal((await fetch(`${base}/mobile/../../etc/passwd`)).status, 404)
})

test('ETag + If-None-Match: a segunda visita e 304 sem corpo', async () => {
  const a = await fetch(`${base}/app.js`)
  const etag = a.headers.get('etag')
  assert.ok(etag)
  assert.equal(a.headers.get('cache-control'), 'no-cache')
  const b = await fetch(`${base}/app.js`, { headers: { 'if-none-match': etag } })
  assert.equal(b.status, 304)
  assert.equal(await b.text(), '')
})

test('o ETag muda quando o arquivo muda', async () => {
  const antes = (await fetch(`${base}/app.js`)).headers.get('etag')
  put('app.js', 'export const a = 22222')
  utimesSync(join(web, 'app.js'), new Date(), new Date(Date.now() + 5000))
  const depois = (await fetch(`${base}/app.js`)).headers.get('etag')
  assert.notEqual(antes, depois)
})

test('sw.js leva o id da versao no lugar do marcador e o id muda quando qualquer asset muda', async () => {
  const a = await (await fetch(`${base}/sw.js`)).text()
  assert.doesNotMatch(a, /__BUILD__/)
  const id = /BUILD = '([^']+)'/.exec(a)?.[1]
  assert.match(id, /^[0-9a-f]{10,}$/)
  put('mobile/mobile.css', 'body{color:red}')
  utimesSync(join(web, 'mobile/mobile.css'), new Date(), new Date(Date.now() + 9000))
  const b = await (await fetch(`${base}/sw.js`)).text()
  assert.notEqual(/BUILD = '([^']+)'/.exec(b)?.[1], id)
})

test('sw.js recebe a lista do pre-cache: paginas, css, js do celular e icones; sem o app.js do desktop nem ele mesmo', async () => {
  const text = await (await fetch(`${base}/sw.js`)).text()
  const list = JSON.parse(/const ASSETS = (\[.*\])/.exec(text)[1])
  for (const url of ['/', '/chat', '/mobile/shell.js', '/mobile/mobile.css', '/icons/icon-192.png', '/manifest.json']) assert.ok(list.includes(url), url)
  assert.ok(!list.includes('/sw.js') && !list.includes('/app.js'))
  assert.doesNotMatch(text, /__ASSETS__/)
})

test('icones podem ficar em cache do navegador; o resto revalida sempre', async () => {
  assert.match((await fetch(`${base}/icons/icon-192.png`)).headers.get('cache-control'), /max-age=\d+/)
  assert.equal((await fetch(`${base}/mobile/shell.js`)).headers.get('cache-control'), 'no-cache')
})

test('so GET e HEAD: POST em arquivo estatico nao e tratado aqui', async () => {
  assert.equal((await fetch(`${base}/app.js`, { method: 'POST' })).status, 404)
})
