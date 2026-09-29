import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-board-'))
  for (const col of ['backlog', 'doing', 'review', 'testando']) mkdirSync(join(projeto, 'cards', col), { recursive: true })
  writeFileSync(join(projeto, 'cards', 'doing', 'CARD-042.md'),
    '---\nid: CARD-042\ntitle: Token opaco com refresh\nstatus: doing\nrisk: alto\nbudget_usd: 8\n---\n\n## Requisitos\n\nR1. O sistema DEVE invalidar o refresh anterior.\n')
  writeFileSync(join(projeto, 'cards', 'backlog', 'CARD-007.md'),
    '---\nid: CARD-007\ntitle: Exportar relatorio\nstatus: backlog\nrisk: baixo\n---\ncorpo\n')
  writeFileSync(join(projeto, 'cards', 'backlog', 'CARD-008.md'),
    '---\nid: CARD-008\ntitle: Card urgente\nstatus: backlog\nrisk: baixo\nprioridade: urgente\n---\ncorpo\n')

  writeFileSync(join(projeto, 'cards', 'testando', 'CARD-300.md'),
    '---\nid: CARD-300\ntitle: Em teste em producao\nstatus: testando\nrisk: baixo\n---\n\n## Como testar\n\n1. Abrir o admin.\n\n## Credenciais necessárias\n\n- CENVIA_PROD_LOGIN — status: preenchida\n- META_TEST_ACCOUNT — status: ausente\n')

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-bd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

test('da para trocar de tela sem recarregar a pagina', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  await browser.esperar(`document.getElementById('tela-board').offsetParent !== null`)
  // Visibilidade de verdade, e nao a propriedade: uma regra de CSS com
  // especificidade maior vence o `hidden` e a propriedade continua dizendo true.
  assert.equal(
    await browser.avaliar(`document.getElementById('tela-fluxo').offsetParent === null`),
    true,
    'a tela anterior precisa sumir de fato, nao so no atributo'
  )
})

test('o board mostra as colunas do pipeline e os cards em cada uma', { skip: pular }, async () => {
  await browser.esperar(`document.querySelectorAll('#tela-board .coluna').length === 9`)
  const texto = await browser.avaliar(`document.getElementById('tela-board').textContent`)
  assert.match(texto, /Token opaco com refresh/)
  assert.match(texto, /Exportar relatorio/)
  const naDoing = await browser.avaliar(
    `document.querySelector('#tela-board .coluna[data-coluna="doing"]').textContent`)
  assert.match(naDoing, /CARD-042/)
  assert.doesNotMatch(naDoing, /CARD-007/, 'card nao pode aparecer na coluna errada')
})

test('risco alto e visivel sem precisar abrir o card', { skip: pular }, async () => {
  const classes = await browser.avaliar(
    `document.querySelector('#tela-board [data-card="CARD-042"]').className`)
  assert.match(classes, /risco-alto/)
})

test('CARD-120: card sem prioridade mostra P3 e legado "urgente" mostra P0, ordenados na coluna', { skip: pular }, async () => {
  const backlog = await browser.avaliar(
    `document.querySelector('#tela-board .coluna[data-coluna="backlog"]').textContent`)
  const posUrgente = backlog.indexOf('CARD-008')
  const posSemP = backlog.indexOf('CARD-007')
  assert.ok(posUrgente >= 0 && posSemP >= 0 && posUrgente < posSemP, 'P0 (urgente) vem antes de P3 (sem prioridade)')
  // CARD-120 (etiquetas): o selo mostra o rótulo humano, não o código cru --
  // "cadê as de prioridade alta?" só tem resposta óbvia se o board FALA a
  // prioridade, não só codifica em P<n>. O título ainda leva o código (title).
  const seloUrgente = await browser.avaliar(
    `document.querySelector('#tela-board [data-card="CARD-008"] .selo-prioridade').textContent`)
  assert.equal(seloUrgente, 'ALTÍSSIMA')
  const tituloUrgente = await browser.avaliar(
    `document.querySelector('#tela-board [data-card="CARD-008"] .selo-prioridade').title`)
  assert.equal(tituloUrgente, 'P0')
  const seloSemP = await browser.avaliar(
    `document.querySelector('#tela-board [data-card="CARD-007"] .selo-prioridade').textContent`)
  assert.equal(seloSemP, 'BAIXA')
})

test('CARD-120: filtro de prioridade esconde os cards que nao sao do P escolhido', { skip: pular }, async () => {
  await browser.avaliar(
    `document.querySelector('#filtro-prioridade [data-p="P0"]').click()`)
  await browser.esperar(`!document.querySelector('#tela-board [data-card="CARD-007"]')`)
  const backlog = await browser.avaliar(
    `document.querySelector('#tela-board .coluna[data-coluna="backlog"]').textContent`)
  assert.match(backlog, /CARD-008/)
  assert.doesNotMatch(backlog, /CARD-007/)
  assert.equal(
    await browser.avaliar(`document.querySelector('#filtro-prioridade [data-p="P0"]').getAttribute('aria-pressed')`),
    'true'
  )
  // devolve o filtro pro estado default -- os testes seguintes contam com "todas".
  await browser.avaliar(`document.querySelector('#filtro-prioridade .chip-todas').click()`)
  await browser.esperar(`!!document.querySelector('#tela-board [data-card="CARD-007"]')`)
})

test('clicar num card abre a spec dele', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('#tela-board [data-card="CARD-042"]').click()`)
  await browser.esperar(`document.getElementById('modal-card').hidden === false`)
  const texto = await browser.avaliar(`document.getElementById('modal-corpo').textContent`)
  assert.match(texto, /R1\. O sistema DEVE invalidar/)
  await browser.avaliar(`document.getElementById('modal-fechar').click()`)
})

test('a tela nao registra erro de JavaScript em nenhuma aba', { skip: pular }, async () => {
  assert.deepEqual(browser.erros, [], browser.erros.join(' | '))
})

/// O board mostra o trabalho PLANEJADO. Quando há agentes trabalhando sem card,
/// a tela precisa dizer isso -- senão um board com dois cards parece o retrato
/// completo enquanto mil eventos acontecem fora dele.
test('o board avisa quando ha trabalho acontecendo fora dele', { skip: pular }, async () => {
  await fetch(`${base}/api/hook`, { method: 'POST', body: JSON.stringify({
    session_id: 'sem-card-1', cwd: '/dev/projeto-x', hook_event_name: 'PostToolUse',
    tool_name: 'Edit', tool_input: { file_path: 'a.ts' }, tool_response: { success: true } }) })

  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  await browser.esperar(`document.getElementById('fora-do-board').textContent.includes('sem card')`)
  const t = await browser.avaliar(`document.getElementById('fora-do-board').textContent`)
  assert.match(t, /projeto-x/, 'precisa dizer ONDE o trabalho está acontecendo')
})

test('CARD-201: coluna Testando fica entre review e done, com contagem no cabecalho', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  const nomes = await browser.avaliar(
    `[...document.querySelectorAll('#tela-board .coluna')].map((c) => c.dataset.coluna).join(',')`)
  assert.match(nomes, /review,testando,done/)
  const cab = await browser.avaliar(
    `document.querySelector('#tela-board .coluna[data-coluna="testando"]>h3').textContent`)
  assert.match(cab, /Testando/)
  assert.match(cab, /1$/)
  assert.match(await browser.avaliar(
    `document.querySelector('#tela-board .coluna[data-coluna="testando"]').textContent`), /CARD-300/)
})

test('CARD-201: o modal mostra Como testar e as credenciais com status por chave', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('#tela-board [data-card="CARD-300"]').click()`)
  await browser.esperar(`document.getElementById('modal-card').hidden === false`)
  assert.match(await browser.avaliar(`document.getElementById('modal-corpo').textContent`), /Como testar/)
  const creds = await browser.avaliar(
    `[...document.querySelectorAll('#modal-credenciais li')].map((li) => li.dataset.status + ':' + li.firstChild.textContent).join('|')`)
  assert.equal(creds, 'preenchida:CENVIA_PROD_LOGIN|ausente:META_TEST_ACCOUNT')
  await browser.avaliar(`document.getElementById('modal-fechar').click()`)
})
