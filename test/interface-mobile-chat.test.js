import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarProjeto, escolherArquivo, subirCelular, tocar } from './apoio/mobile.js'
import { acharChrome } from './apoio/browser.js'
import { makePng } from './apoio/png.js'

/**
 * CARD-094 (4a entrega): no celular o /chat tem o campo de mensagem sempre visivel no rodape
 * (acima da barra de abas, respeitando a area segura), anexo de foto por camera/galeria e
 * botoes de toque de 44 px ou mais. So o campo fixo e o anexo: o resto do chat e do CARD-240.
 */
const chrome = await acharChrome()
const skip = chrome ? false : 'sem Chrome nesta maquina'
let fx, browser, chatDir
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`
const dia = new Date().toISOString().slice(0, 10)

before(async () => {
  const { projeto, card } = criarProjeto()
  card('pendente-diego', 'CARD-701', 'title: Pendente\nprioridade: P0')
  card('review', 'CARD-702', 'title: Revisao\nprioridade: P1')
  const agora = Date.now()
  const chat = Array.from({ length: 40 }, (_, i) => ({ ts: new Date(agora - (60 - i) * 60_000).toISOString(), de: i % 2 ? 'diego' : 'deus', texto: `mensagem numero ${i} com um texto um pouco mais comprido para ocupar espaco`, id: `m${i}` }))
  chat.push({ ts: new Date(agora - 30_000).toISOString(), de: 'deus', texto: 'olha a imagem\n\n[anexo: chat/anexos/2026-01-01/velho-1.png]', id: 'mimg', anexos: [{ arquivo: 'chat/anexos/2026-01-01/velho-1.png', tipo: 'image/png', bytes: 10, largura: 400, altura: 300 }] })
  fx = await subirCelular({ projeto, chat })
  browser = fx.browser
  chatDir = process.env.CONSOLE_CHAT_DIR
  if (!chrome) return
  await browser.ir(`${fx.base}/chat?poll=60000`)
  await browser.esperar(`document.body.dataset.pronto === 'sim' && document.querySelectorAll('.msg').length >= 41`)
})
after(async () => { await fx?.fechar() })

test('campo de mensagem fixo: fica acima da barra de abas, no rodape, e a conversa rola sozinha', { skip }, async () => {
  const before = await browser.avaliar(`(() => { const f = ${q('#envio')}.getBoundingClientRect(); const t = ${q('#m-tabs')}.getBoundingClientRect(); const th = ${q('#thread')};
    return { formBottom: Math.round(f.bottom), tabsTop: Math.round(t.top), tabsBottom: Math.round(t.bottom), inner: innerHeight, scrollable: th.scrollHeight > th.clientHeight, doc: document.documentElement.scrollHeight } })()`)
  assert.equal(before.tabsBottom, before.inner, 'a barra de abas encosta no rodape')
  assert.equal(before.formBottom, before.tabsTop, 'o campo fica logo acima da barra')
  assert.ok(before.scrollable, 'a conversa tem mais que a tela')
  assert.ok(before.doc <= before.inner, 'a pagina nao rola: so a conversa')
  await browser.avaliar(`${q('#thread')}.scrollTop = 0`)
  assert.equal(await browser.avaliar(`Math.round(${q('#envio')}.getBoundingClientRect().bottom)`), before.formBottom, 'o campo nao sai do lugar quando a conversa rola')
})

test('digitando: a barra de abas some e o campo desce ao rodape (recuo da area segura fica com ele)', { skip }, async () => {
  await browser.avaliar(`${q('#texto')}.focus()`)
  await browser.esperar(`getComputedStyle(${q('#m-tabs')}).display === 'none'`)
  const r = await browser.avaliar(`({ formBottom: Math.round(${q('#envio')}.getBoundingClientRect().bottom), inner: innerHeight })`)
  assert.equal(r.formBottom, r.inner)
  await browser.avaliar(`${q('#texto')}.blur()`)
  await browser.esperar(`getComputedStyle(${q('#m-tabs')}).display !== 'none'`)
})

test('a pagina acompanha a area visivel quando o teclado abre (visualViewport)', { skip }, async () => {
  const r = await browser.avaliar(`(async () => {
    const { fitToVisualViewport } = await import('/mobile/viewport.js')
    const listeners = {}
    const fake = { height: innerHeight - 300, offsetTop: 0, addEventListener: (t, f) => { listeners[t] = f }, removeEventListener: () => {} }
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true })
    const el = document.createElement('div')
    const stop = fitToVisualViewport(el)
    const shrunk = { height: el.style.height, bottom: el.style.bottom }
    fake.height = innerHeight
    listeners.resize()
    const back = { height: el.style.height }
    stop()
    return { shrunk, back, expected: innerHeight - 300 + 'px' }
  })()`)
  assert.equal(r.shrunk.height, r.expected)
  assert.equal(r.shrunk.bottom, 'auto')
  assert.equal(r.back.height, '', 'sem teclado nao mexe em nada')
})

test('barra de abas no chat: Chat ativo, links das outras telas e contadores', { skip }, async () => {
  const r = await browser.avaliar(`({ active: ${q('#m-tabs a[aria-current="page"]')}.dataset.tab, hrefs: [...document.querySelectorAll('#m-tabs a')].map((a) => a.getAttribute('href')) })`)
  assert.equal(r.active, 'chat')
  assert.deepEqual(r.hrefs, ['/chat', '/pending', '/board', '/search'])
  await browser.esperar(`${q('[data-badge="pending"]')}.textContent === '1'`)
  assert.equal(await browser.avaliar(`${q('[data-badge="board"]')}.textContent`), '1')
})

test('botoes de toque com 44 px ou mais no campo de mensagem e na barra', { skip }, async () => {
  const small = await browser.avaliar(`[...document.querySelectorAll('#envio button, #envio textarea, #m-tabs a')].filter((e) => e.offsetParent !== null)
    .map((e) => ({ what: e.id || e.className || e.tagName, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })).filter((e) => e.h < 44 || e.w < 44)`)
  assert.deepEqual(small, [])
})

test('mensagem com imagem mostra a miniatura com o espaco reservado e sem a linha [anexo: ...]', { skip }, async () => {
  const r = await browser.avaliar(`(() => { const m = ${q('.msg[data-id="mimg"]')}; const img = m.querySelector('.anexo img'); return { text: m.querySelector('.corpo').textContent.trim(), w: img.getAttribute('width'), h: img.getAttribute('height'), src: img.getAttribute('src') } })()`)
  assert.equal(r.text, 'olha a imagem')
  assert.deepEqual([r.w, r.h, r.src], ['400', '300', '/api/chat/anexos/2026-01-01/velho-1.png'])
})

test('anexar: o menu tem Tirar foto e Escolher da galeria; a camera abre a camera traseira', { skip }, async () => {
  await tocar(browser, '#anexar')
  assert.equal(await browser.avaliar(`${q('#anexar-menu')}.hidden`), false)
  assert.deepEqual(await browser.avaliar(`[...document.querySelectorAll('#anexar-menu button')].map((b) => b.textContent)`), ['Tirar foto', 'Escolher da galeria'])
  assert.equal(await browser.avaliar(`${q('input[type=file][capture]')}.getAttribute('capture')`), 'environment')
  assert.equal(await browser.avaliar(`${q('input[type=file][multiple]')}.accept`), 'image/*')
  await browser.avaliar(`${q('#anexar-menu button')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await browser.esperar(`${q('#anexar-menu')}.hidden`)
})

test('foto grande da galeria: reduzida no aparelho, miniatura no campo, enviada com o texto e vista na conversa', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sle-foto-'))
  const grande = join(dir, 'foto-grande.png')
  writeFileSync(grande, makePng(3200, 2400, [30, 140, 90]))
  await escolherArquivo(browser, 'input[type=file][multiple]', [grande])
  await browser.esperar(`document.querySelectorAll('#previa .previa-item').length === 1`)
  assert.equal(await browser.avaliar(`${q('#previa')}.hidden`), false)
  assert.equal(await browser.avaliar(`${q('#previa img')}.alt`), 'Foto 1 para enviar')
  await browser.avaliar(`${q('#texto')}.value = 'segue a foto do erro'`)
  await tocar(browser, '#envio button[type=submit]')
  await browser.esperar(`!!${q('.msg.diego .anexo img')} && ${q('.msg.diego .anexo img')}.complete && ${q('.msg.diego .anexo img')}.naturalWidth > 0`)
  const saved = readdirSync(join(chatDir, 'chat', 'anexos', dia))
  assert.equal(saved.length, 1)
  const file = join(chatDir, 'chat', 'anexos', dia, saved[0])
  assert.match(saved[0], /-1\.jpg$/, 'foto grande vira JPEG reduzido')
  assert.ok(readFileSync(file).length < 300 * 1024, `${readFileSync(file).length} bytes`)
  const line = readFileSync(join(chatDir, 'chat', `${dia}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse).at(-1)
  assert.equal(line.anexos[0].largura, 1600)
  assert.equal(line.anexos[0].altura, 1200)
  assert.match(line.texto, /^segue a foto do erro\n\n\[anexo: chat\/anexos\//)
  assert.equal(await browser.avaliar(`${q('.msg.diego:last-of-type .corpo')}.textContent.trim()`), 'segue a foto do erro', 'a tela nao mostra a linha [anexo: ...]')
  assert.equal(await browser.avaliar(`${q('#previa')}.hidden`), true, 'a faixa de miniaturas esvazia depois de enviar')
  assert.deepEqual(browser.erros, [])
})

test('so a foto, sem texto, tambem envia; a miniatura pode ser removida; no maximo 4 por mensagem', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sle-foto2-'))
  const paths = Array.from({ length: 5 }, (_, i) => { const p = join(dir, `f${i}.png`); writeFileSync(p, makePng(40, 30, [i * 40, 100, 200])); return p })
  await escolherArquivo(browser, 'input[type=file][multiple]', paths)
  await browser.esperar(`document.querySelectorAll('#previa .previa-item').length === 4`)
  assert.match(await browser.avaliar(`${q('#erro')}.textContent`), /No máximo 4 fotos/)
  await tocar(browser, '#previa .previa-item:nth-child(1) .previa-remover')
  await browser.esperar(`document.querySelectorAll('#previa .previa-item').length === 3`)
  await browser.avaliar(`${q('#texto')}.value = ''`)
  const before = await browser.avaliar(`document.querySelectorAll('.msg.diego').length`)
  await tocar(browser, '#envio button[type=submit]')
  await browser.esperar(`document.querySelectorAll('.msg.diego').length === ${before + 1}`)
  assert.equal(await browser.avaliar(`document.querySelectorAll('.msg.diego:last-of-type .anexo img').length`), 3)
})

test('sem foto o envio segue pela rota de sempre e nao aparece miniatura', { skip }, async () => {
  await browser.avaliar(`${q('#texto')}.value = 'so texto'`)
  await tocar(browser, '#envio button[type=submit]')
  await browser.esperar(`[...document.querySelectorAll('.msg.diego')].some((e) => e.textContent.includes('so texto'))`)
  assert.equal(await browser.avaliar(`document.querySelector('.msg.diego:last-of-type .anexo')`), null)
})
