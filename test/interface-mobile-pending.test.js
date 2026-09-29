import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

/**
 * CARD-094 (1a entrega): no celular a tela inicial e Pendentes, com a barra de abas no rodape
 * (Chat, Pendentes, Quadro, Busca), contadores e um botao por opcao de cada pergunta.
 */
const chrome = await acharChrome()
const skip = chrome ? false : 'sem Chrome nesta maquina'
let base, close, browser, projeto, chatDir, stateDir
const previousEnv = { chat: process.env.CONSOLE_CHAT_DIR, state: process.env.CONSOLE_STATE_DIR }

const card = (coluna, id, front, corpo = '') => {
  mkdirSync(join(projeto, 'cards', coluna), { recursive: true })
  writeFileSync(join(projeto, 'cards', coluna, `${id}.md`), `---\nid: ${id}\nstatus: ${coluna}\n${front}\n---\n${corpo}\n`)
}
const cardFile = (coluna, id) => readFileSync(join(projeto, 'cards', coluna, `${id}.md`), 'utf8')
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`

/** Toque de verdade (CDP): prova que nada cobre o botao, coisa que `.click()` nao prova. */
async function touch(selector) {
  await browser.avaliar(`${q(selector)}.scrollIntoView({ block: 'center' })`)
  const { x, y } = await browser.avaliar(`(() => { const r = ${q(selector)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await browser.chamar('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await browser.chamar('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-mpend-'))
  card('pendente-diego', 'CARD-301', 'title: Backup do MySQL de produção\nprioridade: P0\nproject: infra/backups',
    '## Notas\n\n- 2026-09-29T11:37:14Z · PERGUNTA (Diego): o MySQL não tem backup. Opções: "chave S3" = criar a chave; "mover pra prod" = migrar; "ignorar" = sem backup.')
  card('pendente-diego', 'CARD-302', "title: PENDENTE Billing: 6 assinaturas vencidas. Responda: 'corta no deploy' (sobe como está) ou 'perdoa <ids>' (apaga a fatura) ou 'outra'\nprioridade: P-1\nproject: diegocezimbra/01-app-billing",
    '## Notas\n\n- 2026-09-29T13:21:38Z · backlog → pendente-diego')
  card('pendente-diego', 'CARD-303', 'title: Decidir a correção dos dados\nprioridade: P2', '## Notas\n\n- 2026-09-29T13:58:05Z · backlog → pendente-diego')
  card('pendente-diego', 'CARD-304', 'title: Já decidido\nprioridade: P1',
    '## Notas\n\n- 2026-09-29T10:00:00Z · Opcoes: "sim" | "nao"\n\n## Resposta do Diego (2026-09-29 10:30)\n**Opção:** sim\ncom detalhe\n')
  card('review', 'CARD-310', 'title: Em revisão\nprioridade: P1')
  card('testando', 'CARD-311', 'title: Testando um\nprioridade: P2')
  card('testando', 'CARD-312', 'title: Testando dois\nprioridade: P2')
  card('doing', 'CARD-320', 'title: Em andamento\nprioridade: P1')

  chatDir = mkdtempSync(join(tmpdir(), 'sle-mchat-'))
  mkdirSync(join(chatDir, 'chat'), { recursive: true })
  const now = Date.now()
  const line = (de, minutesAgo, texto) => JSON.stringify({ ts: new Date(now - minutesAgo * 60_000).toISOString(), de, texto, id: `m${minutesAgo}` })
  writeFileSync(join(chatDir, 'chat', `${new Date(now).toISOString().slice(0, 10)}.jsonl`),
    [line('deus', 3, 'primeira'), line('deus', 1, 'segunda')].map((l) => `${l}\n`).join(''))
  stateDir = mkdtempSync(join(tmpdir(), 'sle-mstate-'))
  process.env.CONSOLE_CHAT_DIR = chatDir
  process.env.CONSOLE_STATE_DIR = stateDir

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-mpend-bd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  close = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.celular(390, 844)
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
  // 1a visita: o chat nao tem "nao lido"; volta 1 h no tempo para as 2 mensagens do DEUS contarem.
  await browser.avaliar(`localStorage.setItem('sle.chat.visto', ${JSON.stringify(new Date(now - 60 * 60_000).toISOString())})`)
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim' && document.querySelectorAll('.m-pend').length === 4`)
})
after(async () => {
  await browser?.fechar()
  await close?.()
  for (const [key, value] of [['CONSOLE_CHAT_DIR', previousEnv.chat], ['CONSOLE_STATE_DIR', previousEnv.state]]) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('no celular a aba inicial e Pendentes e a URL vira /pending', { skip }, async () => {
  assert.equal(await browser.avaliar(`location.pathname`), '/pending')
  assert.equal(await browser.avaliar(`document.getElementById('m-title').textContent`), 'Pendentes')
  assert.equal(await browser.avaliar(`document.querySelector('#m-tabs a[aria-current="page"]').dataset.tab`), 'pending')
  assert.equal(await browser.avaliar(`document.documentElement.dataset.modo`), 'mobile')
  assert.deepEqual(browser.erros, [])
})

test('barra de abas fixa no rodape: Chat, Pendentes, Quadro, Busca, cada uma com 44 px ou mais', { skip }, async () => {
  const r = await browser.avaliar(`(() => {
    const nav = document.getElementById('m-tabs').getBoundingClientRect()
    const tabs = [...document.querySelectorAll('#m-tabs a')].map((a) => ({ label: a.querySelector('.m-tab-label').textContent, h: a.getBoundingClientRect().height, w: a.getBoundingClientRect().width }))
    return { bottom: Math.round(nav.bottom), innerHeight, tabs }
  })()`)
  assert.deepEqual(r.tabs.map((t) => t.label), ['Chat', 'Pendentes', 'Quadro', 'Busca'])
  assert.equal(r.bottom, r.innerHeight, 'a barra encosta no rodape da tela')
  for (const t of r.tabs) assert.ok(t.h >= 44 && t.w >= 44, `${t.label}: ${t.w}x${t.h}`)
})

test('as abas mostram contador: pendentes, review+testando e mensagens do DEUS nao lidas', { skip }, async () => {
  await browser.esperar(`document.querySelector('[data-badge="chat"]').textContent === '2'`)
  const badges = await browser.avaliar(`Object.fromEntries([...document.querySelectorAll('.m-badge')].filter((b) => !b.hidden).map((b) => [b.dataset.badge, b.textContent]))`)
  assert.deepEqual(badges, { chat: '2', pending: '4', board: '3' })
  assert.equal(await browser.avaliar(`document.querySelector('#m-tabs a[data-tab="pending"]').innerText.replace(/\\s+/g, ' ').trim()`), 'Pendentes 4', 'o nome acessivel e o texto visivel')
  assert.equal(await browser.avaliar(`document.querySelector('#m-tabs a[data-tab="pending"]').hasAttribute('aria-label')`), false)
})

test('a lista sai por prioridade: P-1, P0, P1, P2', { skip }, async () => {
  const ids = await browser.avaliar(`[...document.querySelectorAll('.m-pend')].map((e) => e.dataset.card)`)
  assert.deepEqual(ids, ['CARD-302', 'CARD-301', 'CARD-304', 'CARD-303'])
})

test('cada item mostra id, P, titulo, a pergunta e um botao por opcao', { skip }, async () => {
  const item = await browser.avaliar(`(() => {
    const el = ${q('[data-card="CARD-301"]')}
    return { id: el.querySelector('.m-id').textContent, p: el.querySelector('.m-pri').textContent, title: el.querySelector('.m-pend-title').textContent,
      question: el.querySelector('.m-question').textContent, options: [...el.querySelectorAll('.m-opt')].map((b) => b.textContent), proj: el.querySelector('.m-proj').textContent }
  })()`)
  assert.equal(item.id, 'CARD-301')
  assert.equal(item.p, 'P0 ALTÍSSIMA')
  assert.equal(item.title, 'Backup do MySQL de produção')
  assert.match(item.question, /MySQL não tem backup/)
  assert.deepEqual(item.options, ['chave S3', 'mover pra prod', 'ignorar'])
  assert.equal(item.proj, 'backups')
})

test('quando a pergunta e o titulo, o titulo aparece com mais linhas e as opcoes vem do titulo', { skip }, async () => {
  const r = await browser.avaliar(`(() => {
    const el = ${q('[data-card="CARD-302"]')}
    return { options: [...el.querySelectorAll('.m-opt')].map((b) => b.textContent), lines: getComputedStyle(el.querySelector('.m-pend-title')).webkitLineClamp, hasQuestion: !!el.querySelector('.m-question') }
  })()`)
  assert.deepEqual(r.options, ['corta no deploy', 'perdoa <ids>', 'outra'])
  assert.equal(r.lines, '6')
  assert.equal(r.hasQuestion, false)
})

test('item sem pergunta em nota nao escreve "null" na tela (filho opcional vazio)', { skip }, async () => {
  const dirty = await browser.avaliar(`[...document.querySelectorAll('.m-pend')].filter((e) => /null|undefined/.test(e.textContent)).map((e) => e.dataset.card)`)
  assert.deepEqual(dirty, [])
})

test('com a pergunta numa caixa propria o titulo nao tem "ver mais"; sem ela, tem', { skip }, async () => {
  const has = (id) => browser.avaliar(`!!${q(`[data-card="${id}"] .m-pend-title-wrap .m-more`)}`)
  assert.equal(await has('CARD-301'), false)
  assert.equal(await has('CARD-302'), true)
})

test('alvos de toque com 44 px ou mais e campo de texto com 16 px (o iOS nao da zoom)', { skip }, async () => {
  const small = await browser.avaliar(`[...document.querySelectorAll('#m-app button, #m-app a, #m-app input')].filter((e) => e.offsetParent !== null)
    .map((e) => ({ what: e.className || e.tagName, h: e.getBoundingClientRect().height })).filter((e) => e.h < 44)`)
  assert.deepEqual(small, [])
  assert.equal(await browser.avaliar(`getComputedStyle(${q('.m-free')}).fontSize`), '16px')
})

test('nunca ha rolagem horizontal, nem da pagina nem da tela', { skip }, async () => {
  const r = await browser.avaliar(`({ doc: document.documentElement.scrollWidth, inner: innerWidth, screen: document.getElementById('m-screen').scrollWidth, client: document.getElementById('m-screen').clientWidth })`)
  assert.ok(r.doc <= r.inner, `pagina ${r.doc} > ${r.inner}`)
  assert.ok(r.screen <= r.client, `tela ${r.screen} > ${r.client}`)
})

test('tocar numa opcao registra a resposta no card e o item passa a dizer "respondido"', { skip }, async () => {
  await touch('[data-card="CARD-301"] .m-opt[data-option="chave S3"]')
  await browser.esperar(`!!${q('[data-card="CARD-301"] .m-answered')}`)
  assert.match(await browser.avaliar(`${q('[data-card="CARD-301"] .m-answered')}.textContent`), /respondido: chave S3/)
  assert.match(cardFile('pendente-diego', 'CARD-301'), /## Resposta do Diego \(.*\)\n\*\*Opção:\*\* chave S3/)
  assert.equal(await browser.avaliar(`!!${q('[data-card="CARD-301"] .m-opt')}`), false, 'os botoes saem depois de responder')
})

test('opcao com <ids> ou "outra" nao envia: prepara o campo de texto', { skip }, async () => {
  await touch('[data-card="CARD-302"] .m-opt[data-option="perdoa <ids>"]')
  assert.equal(await browser.avaliar(`${q('[data-card="CARD-302"] .m-free')}.value`), 'perdoa ')
  assert.equal(await browser.avaliar(`document.activeElement === ${q('[data-card="CARD-302"] .m-free')}`), true)
  await touch('[data-card="CARD-302"] .m-opt[data-option="outra"]')
  assert.equal(await browser.avaliar(`${q('[data-card="CARD-302"] .m-free')}.value`), '')
  assert.doesNotMatch(cardFile('pendente-diego', 'CARD-302'), /Resposta do Diego/)
})

test('texto livre: sem opcoes o campo e o unico caminho e o envio grava a resposta', { skip }, async () => {
  assert.equal(await browser.avaliar(`document.querySelectorAll('[data-card="CARD-303"] .m-opt').length`), 0)
  await browser.avaliar(`${q('[data-card="CARD-303"] .m-free')}.value = 'corrige os 15 fluxos'`)
  await touch('[data-card="CARD-303"] .m-send')
  await browser.esperar(`!!${q('[data-card="CARD-303"] .m-answered')}`)
  assert.match(cardFile('pendente-diego', 'CARD-303'), /\*\*Opção:\*\* —\ncorrige os 15 fluxos/)
})

test('card ja respondido chega marcado, com a resposta e o "responder de novo"', { skip }, async () => {
  const text = await browser.avaliar(`${q('[data-card="CARD-304"] .m-answered')}.textContent`)
  assert.match(text, /respondido: sim — com detalhe/)
  await touch('[data-card="CARD-304"] .m-again')
  assert.equal(await browser.avaliar(`document.querySelectorAll('[data-card="CARD-304"] .m-opt').length`), 2)
})

test('sem nenhum card pendente a tela diz "Nada esperando por você"', { skip }, async () => {
  for (const id of ['CARD-301', 'CARD-302', 'CARD-303', 'CARD-304']) unlinkSync(join(projeto, 'cards', 'pendente-diego', `${id}.md`))
  await browser.avaliar(`document.dispatchEvent(new Event('visibilitychange'))`)
  await browser.esperar(`document.querySelectorAll('.m-pend').length === 0`)
  assert.equal(await browser.avaliar(`document.querySelector('.m-empty:not([hidden]) .m-empty-title').textContent`), 'Nada esperando por você')
  assert.equal(await browser.avaliar(`document.querySelector('[data-badge="pending"]').hidden`), true)
})
