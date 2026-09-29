import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { criarProjeto, deslizar, subirCelular, tocar } from './apoio/mobile.js'
import { acharChrome } from './apoio/browser.js'

/**
 * CARD-094 (2a entrega): Quadro com uma coluna por vez (abas fixas com contador + deslize lateral),
 * filtros de prioridade e projeto num painel deslizante, e a aba Busca.
 */
const chrome = await acharChrome()
const skip = chrome ? false : 'sem Chrome nesta maquina'
const ORDER = ['backlog', 'refinamento', 'aprovado', 'doing', 'review', 'testando', 'done', 'pendente-diego', 'recurring']
let fx, browser
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`
const settled = (name) => `(() => { const p = document.querySelector('.m-pager'); return p.scrollLeft === ${ORDER.indexOf(name)} * p.clientWidth })()`
const activeTab = () => browser.avaliar(`${q('.m-col-tab[aria-selected="true"]')}.dataset.col`)

before(async () => {
  const { projeto, card } = criarProjeto()
  card('review', 'CARD-401', 'title: Migrar autenticação para token opaco\nprioridade: P0\nproject: tzo-company/cenvia')
  card('review', 'CARD-402', 'title: Refatorar o módulo de cobrança\nprioridade: P1\nproject: diegocezimbra/01-app-billing', 'Usa arquitetura hexagonal com portas e adaptadores.')
  card('review', 'CARD-403', 'title: Sem projeto\nprioridade: P3\nproject:')
  card('backlog', 'CARD-410', 'title: Tarefa de infra\nprioridade: P2\nproject: infra')
  card('backlog', 'CARD-411', 'title: Backup urgente\nprioridade: P-1\nproject: infra')
  card('doing', 'CARD-420', 'title: Em andamento um\nprioridade: P1\nproject: tzo-company/cenvia')
  card('doing', 'CARD-421', 'title: Em andamento dois\nprioridade: P0\nproject: tzo-company/cenvia')
  card('testando', 'CARD-430', 'title: Testando um\nprioridade: P2')
  card('testando', 'CARD-431', 'title: Testando dois\nprioridade: P2')
  card('pendente-diego', 'CARD-450', 'title: Decidir algo\nprioridade: P0')
  for (let i = 0; i < 45; i++) card('done', `CARD-${500 + i}`, `title: Entregue ${i}\nprioridade: P3`)
  if (!chrome) return
  fx = await subirCelular({ projeto })
  browser = fx.browser
  await browser.ir(`${fx.base}/board`)
  await browser.esperar(`document.querySelectorAll('.m-col-tab').length === 9 && document.body.dataset.pronto === 'sim'`)
})
after(async () => { await fx?.fechar() })

test('Quadro: nove colunas na ordem do board, com contador, e review aberta por padrao', { skip }, async () => {
  const tabs = await browser.avaliar(`[...document.querySelectorAll('.m-col-tab')].map((t) => [t.dataset.col, t.querySelector('.m-col-count').textContent])`)
  assert.deepEqual(tabs.map((t) => t[0]), ORDER)
  assert.deepEqual(Object.fromEntries(tabs), { backlog: '2', refinamento: '0', aprovado: '0', doing: '2', review: '3', testando: '2', done: '45', 'pendente-diego': '1', recurring: '0' })
  assert.equal(await activeTab(), 'review')
  assert.equal(await browser.avaliar(`location.pathname + location.search`), '/board?c=review')
  assert.equal(await browser.avaliar(`document.getElementById('m-title').textContent`), 'Quadro')
})

test('uma coluna por vez: cada coluna ocupa a largura da tela e a pagina nao rola de lado', { skip }, async () => {
  const r = await browser.avaliar(`(() => {
    const pager = ${q('.m-pager')}
    return { widths: [...document.querySelectorAll('.m-col')].map((c) => Math.round(c.getBoundingClientRect().width)), inner: innerWidth,
      pagerScroll: pager.scrollWidth, pagerClient: pager.clientWidth, doc: document.documentElement.scrollWidth,
      left: pager.scrollLeft, expected: 4 * pager.clientWidth }
  })()`)
  assert.ok(r.widths.every((w) => w === r.inner), `larguras ${r.widths} vs ${r.inner}`)
  assert.equal(r.pagerScroll, 9 * r.pagerClient)
  assert.ok(r.doc <= r.inner, `pagina ${r.doc} > ${r.inner}`)
  assert.equal(r.left, r.expected, 'a coluna review (a 5a) esta na frente')
})

test('as abas das colunas ficam fixas no topo enquanto a coluna rola', { skip }, async () => {
  await tocar(browser, '.m-col-tab[data-col="done"]')
  await browser.esperar(settled('done'))
  const before = await browser.avaliar(`Math.round(${q('.m-col-tabs')}.getBoundingClientRect().top)`)
  await browser.avaliar(`${q('.m-col[data-col="done"]')}.scrollTop = 900`)
  assert.ok(await browser.avaliar(`${q('.m-col[data-col="done"]')}.scrollTop > 100`), 'a coluna done rolou')
  assert.equal(await browser.avaliar(`Math.round(${q('.m-col-tabs')}.getBoundingClientRect().top)`), before)
  assert.equal(await browser.avaliar(`document.documentElement.scrollTop + document.body.scrollTop`), 0, 'a pagina nao rolou')
})

test('tocar numa aba leva a coluna, marca a aba e grava ?c= na URL', { skip }, async () => {
  await tocar(browser, '.m-col-tab[data-col="backlog"]')
  await browser.esperar(settled('backlog'))
  assert.equal(await activeTab(), 'backlog')
  assert.equal(await browser.avaliar(`location.search`), '?c=backlog')
})

test('deslizar o dedo troca de coluna (uma por vez) e a aba acompanha', { skip }, async () => {
  await deslizar(browser, { dx: -260 })
  await browser.esperar(settled('refinamento'))
  assert.equal(await activeTab(), 'refinamento')
  await deslizar(browser, { x: 60, dx: 260 })
  await browser.esperar(settled('backlog'))
  assert.equal(await activeTab(), 'backlog', 'parou alinhada numa coluna e a aba acompanhou')
})

test('linha do card: id, P, projeto e titulo em ate 2 linhas; o card e um link', { skip }, async () => {
  await tocar(browser, '.m-col-tab[data-col="review"]')
  await browser.esperar(settled('review'))
  const row = await browser.avaliar(`(() => {
    const el = ${q('.m-row[data-card="CARD-401"]')}
    return { id: el.querySelector('.m-row-id').textContent, p: el.querySelector('.m-pri').textContent, proj: el.querySelector('.m-proj').textContent,
      clamp: getComputedStyle(el.querySelector('.m-row-title')).webkitLineClamp, href: el.getAttribute('href'), h: el.getBoundingClientRect().height }
  })()`)
  assert.deepEqual({ id: row.id, p: row.p, proj: row.proj, clamp: row.clamp, href: row.href }, { id: 'CARD-401', p: 'P0', proj: 'cenvia', clamp: '2', href: '/card/CARD-401' })
  assert.ok(row.h >= 44)
  assert.equal(await browser.avaliar(`[...document.querySelectorAll('.m-col[data-col="review"] .m-row')].map((r) => r.dataset.card).join()`), 'CARD-401,CARD-402,CARD-403', 'ordem por prioridade')
})

test('coluna grande mostra 40 e o resto vem em "Mostrar mais"', { skip }, async () => {
  await tocar(browser, '.m-col-tab[data-col="done"]')
  await browser.esperar(settled('done'))
  assert.equal(await browser.avaliar(`document.querySelectorAll('.m-col[data-col="done"] .m-row').length`), 40)
  assert.equal(await browser.avaliar(`${q('.m-col[data-col="done"] .m-more-rows')}.textContent`), 'Mostrar mais (5)')
  await tocar(browser, '.m-col[data-col="done"] .m-more-rows')
  await browser.esperar(`document.querySelectorAll('.m-col[data-col="done"] .m-row').length === 45`)
  assert.equal(await browser.avaliar(`${q('.m-col[data-col="done"] .m-more-rows')}.hidden`), true)
})

test('coluna vazia diz que esta vazia', { skip }, async () => {
  await tocar(browser, '.m-col-tab[data-col="refinamento"]')
  await browser.esperar(settled('refinamento'))
  assert.equal(await browser.avaliar(`${q('.m-col[data-col="refinamento"] .m-col-empty')}.hidden`), false)
})

test('filtros: o painel desliza da direita, filtra por prioridade e projeto, e limpa', { skip }, async () => {
  await tocar(browser, '.m-col-tab[data-col="review"]')
  await browser.esperar(settled('review'))
  await tocar(browser, '.m-top-btn')
  await browser.esperar(`!!${q('.m-drawer-overlay.open')} && Math.round(${q('.m-drawer')}.getBoundingClientRect().right) === innerWidth`)
  const box = await browser.avaliar(`(() => { const r = ${q('.m-drawer')}.getBoundingClientRect(); return { right: Math.round(r.right), width: Math.round(r.width), inner: innerWidth, role: ${q('.m-drawer')}.getAttribute('role') } })()`)
  assert.equal(box.right, box.inner)
  assert.ok(box.width <= 360 && box.width < box.inner)
  assert.equal(box.role, 'dialog')
  await tocar(browser, '.m-fchip[data-p="P0"]')
  await browser.esperar(`document.querySelector('.m-col-tab[data-col="review"] .m-col-count').textContent === '1'`)
  assert.equal(await browser.avaliar(`location.search.includes('p=P0')`), true)
  assert.equal(await browser.avaliar(`${q('.m-top-btn .m-badge')}.textContent`), '1')
  await browser.avaliar(`(() => { const s = ${q('.m-select')}; s.value = 'tzo-company/cenvia'; s.dispatchEvent(new Event('change')) })()`)
  await browser.esperar(`document.querySelector('.m-col-tab[data-col="doing"] .m-col-count').textContent === '1'`)
  assert.equal(await browser.avaliar(`location.search.includes('proj=')`), true)
  assert.equal(await browser.avaliar(`${q('.m-apply')}.textContent`), 'Ver 2 cards')
  await tocar(browser, '.m-clear')
  await browser.esperar(`document.querySelector('.m-col-tab[data-col="review"] .m-col-count').textContent === '3'`)
  assert.equal(await browser.avaliar(`/[?&](p|proj)=/.test(location.search)`), false)
  await browser.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await browser.esperar(`!document.querySelector('.m-drawer-overlay')`)
  assert.equal(await browser.avaliar(`document.activeElement.classList.contains('m-top-btn')`), true, 'o foco volta ao botao')
})

test('aba Busca: recentes sem termo, acha no corpo com trecho, e diz quando nao acha', { skip }, async () => {
  await tocar(browser, '#m-tabs a[data-tab="search"]')
  await browser.esperar(`location.pathname === '/search' && document.querySelectorAll('.m-search-list .m-row').length > 0`)
  assert.equal(await browser.avaliar(`document.activeElement === ${q('.m-search-input')}`), true, 'o campo ja abre focado')
  assert.match(await browser.avaliar(`${q('.m-search-status')}.textContent`), /Mexidos por último/)
  await browser.avaliar(`(() => { const i = ${q('.m-search-input')}; i.value = 'HEXAGONAL'; i.dispatchEvent(new Event('input')) })()`)
  await browser.esperar(`[...document.querySelectorAll('.m-search-list .m-row')].map((r) => r.dataset.card).join() === 'CARD-402'`)
  assert.match(await browser.avaliar(`${q('.m-row-snippet')}.textContent`), /arquitetura hexagonal/)
  assert.equal(await browser.avaliar(`${q('.m-search-list .m-col-chip')}.textContent`), 'Review')
  assert.equal(await browser.avaliar(`location.search`), '?q=HEXAGONAL')
  await browser.avaliar(`(() => { const i = ${q('.m-search-input')}; i.value = 'zzzzqq'; i.dispatchEvent(new Event('input')) })()`)
  await browser.esperar(`${q('.m-search-status')}.textContent.startsWith('Nada encontrado')`)
})

test('trocar de aba empilha historico: o botao voltar do sistema volta a aba anterior', { skip }, async () => {
  await tocar(browser, '#m-tabs a[data-tab="pending"]')
  await browser.esperar(`location.pathname === '/pending'`)
  await browser.avaliar(`history.back()`)
  await browser.esperar(`location.pathname === '/search' && document.getElementById('m-title').textContent === 'Busca'`)
  assert.equal(await browser.avaliar(`${q('#m-tabs a[aria-current="page"]')}.dataset.tab`), 'search')
  assert.deepEqual(browser.erros, [])
})
