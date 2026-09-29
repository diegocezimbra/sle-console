import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { criarProjeto, subirCelular, tocar } from './apoio/mobile.js'
import { acharChrome } from './apoio/browser.js'
import { listSubscriptions } from '../src/push.js'

/**
 * CARD-094 (5a entrega): PWA. Manifesto (nome, icone, cor, standalone), service worker com cache dos
 * assets e leitura offline do ultimo estado, e registro de push (o disparo e do CARD-240).
 */
const chrome = await acharChrome()
const skip = chrome ? false : 'sem Chrome nesta maquina'
let fx, browser
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`

// O Chrome headless nao fala com o servico de push (FCM): a assinatura e simulada; o resto (permissao,
// cadastro no servidor, estado do botao) roda de verdade.
const FAKE_PUSH = `(() => {
  let current = null
  const b64 = (n, first) => btoa(String.fromCharCode(...(first ? [4] : []), ...crypto.getRandomValues(new Uint8Array(n - (first ? 1 : 0))))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
  PushManager.prototype.subscribe = async function () {
    current = { endpoint: 'https://fcm.googleapis.com/fcm/send/teste-' + Math.random().toString(16).slice(2), unsubscribe: async () => { current = null; return true } }
    current.toJSON = () => ({ endpoint: current.endpoint, keys: { p256dh: b64(65, true), auth: b64(16, false) } })
    return current
  }
  PushManager.prototype.getSubscription = async () => current
  Notification.requestPermission = async () => { Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true }); return 'granted' }
})()`

before(async () => {
  const { projeto, card } = criarProjeto()
  card('pendente-diego', 'CARD-801', 'title: Decidir o backup\nprioridade: P0', '## Notas\n\n- 2026-09-29T11:37:14Z · PERGUNTA (Diego): faz? Opcoes: "sim" | "nao"')
  card('review', 'CARD-802', 'title: Em revisão\nprioridade: P1')
  if (!chrome) return
  fx = await subirCelular({ projeto })
  browser = fx.browser
  await browser.chamar('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_PUSH })
  await browser.ir(`${fx.base}/pending`)
  await browser.esperar(`document.body.dataset.pronto === 'sim' && document.querySelectorAll('.m-pend').length === 1`)
})
after(async () => { await fx?.fechar() })

test('manifesto: nome, cor, standalone, escopo e icones que existem com o tamanho declarado', { skip }, async () => {
  const r = await fetch(`${fx.base}/manifest.json`)
  assert.equal(r.headers.get('content-type'), 'application/manifest+json')
  const m = await r.json()
  assert.equal(m.name, 'SLE Console')
  assert.equal(m.display, 'standalone')
  assert.equal(m.theme_color, '#0f1115')
  assert.equal(m.scope, '/')
  assert.match(m.start_url, /^\//)
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'))
  for (const icon of m.icons) {
    const png = Buffer.from(await (await fetch(fx.base + icon.src)).arrayBuffer())
    assert.equal(png.subarray(1, 4).toString(), 'PNG', icon.src)
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes, icon.src)
  }
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === size && i.purpose === 'any'), `icone ${size}`)
})

test('as paginas apontam o manifesto e o icone do iOS, com os metas de app', { skip }, async () => {
  for (const rota of ['/', '/chat']) {
    const html = await (await fetch(fx.base + rota)).text()
    for (const trecho of ['rel="manifest" href="/manifest.json"', 'rel="apple-touch-icon" href="/icons/apple-touch-icon.png"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title"']) {
      assert.ok(html.includes(trecho), `${rota}: ${trecho}`)
    }
  }
  const png = Buffer.from(await (await fetch(`${fx.base}/icons/apple-touch-icon.png`)).arrayBuffer())
  assert.equal(png.readUInt32BE(16), 180)
})

test('o Chrome nao aponta nenhum erro de instalabilidade', { skip }, async () => {
  const { installabilityErrors } = await browser.chamar('Page.getInstallabilityErrors')
  assert.deepEqual(installabilityErrors, [])
})

test('service worker assume o controle e pre-cacheia paginas, js do celular, css e icones', { skip }, async () => {
  await browser.esperar(`navigator.serviceWorker.ready.then((r) => !!r.active)`)
  await browser.ir(`${fx.base}/pending`) // recarrega ja sob o controle do sw
  await browser.esperar(`document.body.dataset.pronto === 'sim' && !!navigator.serviceWorker.controller`)
  const cached = await browser.avaliar(`(async () => { const names = await caches.keys(); const shell = names.find((n) => n.startsWith('sle-shell-')); const keys = (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname); return { shell, keys } })()`)
  const build = /BUILD = '([0-9a-f]+)'/.exec(await (await fetch(`${fx.base}/sw.js`)).text())[1]
  assert.equal(cached.shell, `sle-shell-${build}`)
  for (const url of ['/', '/chat', '/mobile/shell.js', '/mobile/pending.js', '/mobile/mobile.css', '/style.css', '/manifest.json', '/icons/icon-192.png', '/chat.js']) assert.ok(cached.keys.includes(url), `pre-cache de ${url}`)
  assert.ok(!cached.keys.includes('/app.js'), 'o desktop nao entra no cache do celular')
})

test('botao Avisos: pede permissao, cadastra o aparelho no servidor e desativa no segundo toque', { skip }, async () => {
  await browser.esperar(`!!${q('.m-notify')}`)
  assert.equal(await browser.avaliar(`${q('.m-notify')}.textContent`), 'Ativar avisos')
  await tocar(browser, '.m-notify')
  await browser.esperar(`${q('.m-notify')}.dataset.state === 'subscribed'`)
  assert.equal(await browser.avaliar(`${q('.m-notify')}.textContent`), 'Avisos ativos')
  const [saved] = listSubscriptions(fx.dados)
  assert.match(saved.endpoint, /^https:\/\/fcm\.googleapis\.com\//)
  assert.match(saved.label, /^(Android|Computador)/)
  await tocar(browser, '.m-notify')
  await browser.esperar(`${q('.m-notify')}.dataset.state === 'available'`)
  assert.deepEqual(listSubscriptions(fx.dados), [])
})

test('sem rede o app abre pelo cache e mostra o ultimo estado com o aviso', { skip }, async () => {
  await browser.avaliar(`fetch('/api/cards?summary=1&projeto=*').then((r) => r.status)`) // garante o ultimo estado guardado
  await fx.pararServidor()
  await browser.ir(`${fx.base}/pending`)
  await browser.esperar(`document.body.dataset.pronto === 'sim' && document.querySelectorAll('.m-pend').length === 1`, { limite: 15000 })
  assert.equal(await browser.avaliar(`${q('[data-card="CARD-801"] .m-pend-title')}.textContent`), 'Decidir o backup')
  assert.equal(await browser.avaliar(`${q('#m-offline')}.hidden`), false)
  assert.match(await browser.avaliar(`${q('#m-offline')}.textContent`), /^Sem conexão: mostrando o último estado \(/)
  assert.equal(await browser.avaliar(`${q('[data-badge="pending"]')}.textContent`), '1')
  // sem rede a resposta nao vai: o erro diz isso em vez de fingir sucesso
  await tocar(browser, '[data-card="CARD-801"] .m-opt[data-option="sim"]')
  await browser.esperar(`!${q('[data-card="CARD-801"] .m-error')}.hidden`)
  assert.match(await browser.avaliar(`${q('[data-card="CARD-801"] .m-error')}.textContent`), /Sem conexão/)
})

test('faixa de versao nova: aviso com botao Recarregar de 44 px', { skip }, async () => {
  const r = await browser.avaliar(`(async () => { const { showUpdateBanner } = await import('/mobile/pwa.js'); showUpdateBanner(); showUpdateBanner()
    return { banners: document.querySelectorAll('.m-update').length, h: ${q('.m-update-btn')}.getBoundingClientRect().height, text: ${q('.m-update')}.textContent } })()`)
  assert.equal(r.banners, 1, 'nao empilha')
  assert.ok(r.h >= 44)
  assert.match(r.text, /Nova versão instalada/)
})
