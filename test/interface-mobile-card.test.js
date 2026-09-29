import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { criarProjeto, subirCelular, tocar } from './apoio/mobile.js'
import { acharChrome } from './apoio/browser.js'

/**
 * CARD-094 (3a entrega): o card abre em tela cheia (voltar com o historico do navegador), com
 * "Dados" e "Atividades da IA" recolhidas, campo de resposta grande, botoes de opcao e o
 * botao Responder fixo no rodape.
 */
const chrome = await acharChrome()
const skip = chrome ? false : 'sem Chrome nesta maquina'
let fx, browser, projeto
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`
const cardFile = (coluna, id) => readFileSync(join(projeto, 'cards', coluna, `${id}.md`), 'utf8')
const URL_LONGA = `https://exemplo.com/${'um/caminho/muito/longo/'.repeat(8)}fim`

before(async () => {
  const fixture = criarProjeto()
  projeto = fixture.projeto
  const { card } = fixture
  card('pendente-diego', 'CARD-601', 'title: Backup do MySQL de produção sem nenhuma rotina\nprioridade: P0\nrisk: alto\nproject: infra/backups\nowner: sonnet\nprazo: 6',
    `## Objetivo\n\nProteger o banco. Veja ${URL_LONGA}\n\n## Credenciais necessárias\n\n- SOME_KEY — status: ausente\n\n## Notas\n\n- 2026-09-29T11:35:54Z · criado\n- 2026-09-29T11:37:14Z · PERGUNTA (Diego): o MySQL não tem backup. Opções: "chave S3" = criar; "ignorar" = nada; "perdoa <ids>" = perdoar.`)
  card('review', 'CARD-602', 'title: Card em revisão\nprioridade: P1',
    '## Objetivo\n\nTexto de revisão.\n\n## Notas\n\n- 2026-09-29T10:00:00Z · criado\n- 2026-09-29T10:05:00Z · virou review\n\n## Resposta do Diego (2026-09-29 10:30)\n**Opção:** aprovado\ncom ressalva\n')
  card('doing', 'CARD-603', 'title: Em andamento\nprioridade: P2')
  if (!chrome) return
  fx = await subirCelular({ projeto })
  browser = fx.browser
  await browser.ir(`${fx.base}/pending`)
  await browser.esperar(`document.body.dataset.pronto === 'sim' && !!document.querySelector('[data-card="CARD-601"]')`)
})
after(async () => { await fx?.fechar() })

const cardOpen = `!document.getElementById('m-card').hidden && !!document.querySelector('#m-card .m-card-title')`

test('tocar no card abre em tela cheia, empilha historico e tira o app de baixo do alcance', { skip }, async () => {
  await tocar(browser, '[data-card="CARD-601"] .m-id')
  await browser.esperar(`location.pathname === '/card/CARD-601' && ${cardOpen}`)
  const r = await browser.avaliar(`(() => { const b = document.getElementById('m-card').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, inner: [innerWidth, innerHeight], inert: document.getElementById('m-app').inert,
    hit: document.elementFromPoint(195, innerHeight - 20)?.closest('#m-card') !== null } })()`)
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, ...r.inner])
  assert.equal(r.inert, true)
  assert.equal(r.hit, true, 'a barra de abas nao fica clicavel por baixo do card')
  assert.deepEqual(browser.erros, [])
})

test('cabecalho: titulo inteiro, prioridade, risco, projeto e a pergunta com um botao por opcao', { skip }, async () => {
  const c = await browser.avaliar(`({ title: ${q('.m-card-title')}.textContent, chips: [...document.querySelectorAll('#m-card .m-chips .m-chip')].map((e) => e.textContent),
    topId: ${q('.m-card-topid')}.textContent, question: ${q('.m-question-text')}.textContent, options: [...document.querySelectorAll('#m-card .m-opt')].map((b) => b.textContent),
    alert: ${q('.m-alert')}.textContent })`)
  assert.equal(c.title, 'Backup do MySQL de produção sem nenhuma rotina')
  assert.deepEqual(c.chips, ['P0 ALTÍSSIMA', 'risco alto', 'infra/backups'])
  assert.equal(c.topId, 'CARD-601')
  assert.match(c.question, /o MySQL não tem backup/)
  assert.deepEqual(c.options, ['chave S3', 'ignorar', 'perdoa <ids>'])
  assert.match(c.alert, /Faltam credenciais de teste: SOME_KEY/)
})

test('nenhum filho opcional vazio vira a palavra "null" na tela', { skip }, async () => {
  assert.equal(await browser.avaliar(`/\\bnull\\b|undefined/.test(${q('#m-card .m-card-body')}.textContent)`), false)
})

test('titulo longo e cortado em 4 linhas com "ver mais" (a pergunta nao vai para debaixo da dobra)', { skip }, async () => {
  const r = await browser.avaliar(`({ clamp: getComputedStyle(${q('.m-card-title')}).webkitLineClamp, id: ${q('.m-card-title')}.id, labelled: document.getElementById('m-card').getAttribute('aria-labelledby') })`)
  assert.deepEqual(r, { clamp: '4', id: 'm-card-title', labelled: 'm-card-title' })
})

test('Dados e Atividades da IA comecam recolhidas; abrem com toque e nao repetem o que ja aparece fora', { skip }, async () => {
  assert.deepEqual(await browser.avaliar(`[...document.querySelectorAll('#m-card details.m-fold')].map((d) => [d.querySelector('summary').textContent, d.open])`), [['Dados', false], ['Atividades da IA', false]])
  await tocar(browser, '#m-card details.m-fold:nth-of-type(1) summary')
  await browser.esperar(`${q('#m-card details.m-fold')}.open`)
  const dados = await browser.avaliar(`${q('#m-card details.m-fold .m-fold-body')}.textContent`)
  assert.match(dados, /Proteger o banco/)
  assert.match(dados, /Projeto\s*infra\/backups/)
  assert.doesNotMatch(dados, /PERGUNTA \(Diego\)/, 'as notas ficam em Atividades, nao em Dados')
  assert.match(await browser.avaliar(`${q('#m-card .m-cred-list')}.textContent`), /SOME_KEY\s*ausente/)
  await tocar(browser, '#m-card details.m-fold:nth-of-type(2) summary')
  const acts = await browser.avaliar(`[...document.querySelectorAll('#m-card .m-activity li')].map((li) => li.querySelector('span').textContent)`)
  assert.match(acts[0], /^PERGUNTA/, 'a mais recente primeiro')
  assert.equal(acts.at(-1), 'criado')
})

test('campo de resposta grande e botao Responder fixo no rodape, mesmo com o corpo rolado', { skip }, async () => {
  const before = await browser.avaliar(`(() => { const t = ${q('.m-answer-text')}.getBoundingClientRect(); const f = ${q('.m-card-foot')}.getBoundingClientRect(); const r = ${q('.m-respond')}.getBoundingClientRect();
    return { textareaH: Math.round(t.height), fontSize: getComputedStyle(${q('.m-answer-text')}).fontSize, footBottom: Math.round(f.bottom), inner: innerHeight, respondH: Math.round(r.height) } })()`)
  assert.ok(before.textareaH >= 120, `campo com ${before.textareaH}px`)
  assert.equal(before.fontSize, '16px')
  assert.equal(before.footBottom, before.inner)
  assert.ok(before.respondH >= 48)
  await browser.avaliar(`${q('.m-card-body')}.scrollTop = 99999`)
  assert.ok(await browser.avaliar(`${q('.m-card-body')}.scrollTop > 100`))
  assert.equal(await browser.avaliar(`Math.round(${q('.m-card-foot')}.getBoundingClientRect().bottom)`), before.inner)
})

test('nunca ha rolagem horizontal, nem com URL comprida no corpo', { skip }, async () => {
  const r = await browser.avaliar(`({ body: ${q('.m-card-body')}.scrollWidth - ${q('.m-card-body')}.clientWidth, doc: document.documentElement.scrollWidth - innerWidth })`)
  assert.ok(r.body <= 0, `corpo rola ${r.body}px de lado`)
  assert.ok(r.doc <= 0)
})

test('Responder sem nada escolhido avisa e nao grava', { skip }, async () => {
  await tocar(browser, '.m-respond')
  await browser.esperar(`!${q('.m-answer-box .m-error')}.hidden`)
  assert.match(await browser.avaliar(`${q('.m-answer-box .m-error')}.textContent`), /Escolha uma opção/)
  assert.doesNotMatch(cardFile('pendente-diego', 'CARD-601'), /Resposta do Diego/)
})

test('opcao com <ids> prepara o texto; opcao comum marca o botao; Responder grava opcao + texto', { skip }, async () => {
  await tocar(browser, '#m-card .m-opt[data-option="perdoa <ids>"]')
  assert.equal(await browser.avaliar(`${q('.m-answer-text')}.value`), 'perdoa ')
  await browser.avaliar(`${q('.m-answer-text')}.value = ''`)
  await tocar(browser, '#m-card .m-opt[data-option="chave S3"]')
  assert.equal(await browser.avaliar(`${q('#m-card .m-opt[data-option="chave S3"]')}.getAttribute('aria-pressed')`), 'true')
  await browser.avaliar(`${q('.m-answer-text')}.value = 'usa a conta do DEV'`)
  await tocar(browser, '.m-respond')
  await browser.esperar(`!!${q('#m-card .m-prev-item')}`)
  assert.match(cardFile('pendente-diego', 'CARD-601'), /\*\*Opção:\*\* chave S3\nusa a conta do DEV/)
  assert.match(await browser.avaliar(`${q('#m-card .m-prev-item')}.textContent`), /chave S3.*usa a conta do DEV/)
  assert.equal(await browser.avaliar(`${q('.m-answer-text')}.value`), '')
  assert.equal(await browser.avaliar(`${q('#m-card .m-opt[data-option="chave S3"]')}.getAttribute('aria-pressed')`), 'false')
  assert.equal(await browser.avaliar(`${q('.m-respond')}.disabled`), false)
})

test('card pendente tem Resolvida no rodape; card de outra coluna nao', { skip }, async () => {
  assert.equal(await browser.avaliar(`${q('.m-resolve')}.hidden`), false)
  await tocar(browser, '.m-back')
  await browser.esperar(`location.pathname === '/pending' && document.getElementById('m-card').hidden`)
  await browser.ir(`${fx.base}/card/CARD-602`)
  await browser.esperar(cardOpen)
  assert.equal(await browser.avaliar(`${q('.m-resolve')}.hidden`), true)
  assert.equal(await browser.avaliar(`${q('.m-respond')}.hidden`), false)
  assert.match(await browser.avaliar(`${q('#m-card .m-prev-item')}.textContent`), /aprovado.*com ressalva/)
})

test('link direto para um card: a seta voltar cai no Quadro (nao sai do app)', { skip }, async () => {
  assert.equal(await browser.avaliar(`location.pathname`), '/card/CARD-602')
  await tocar(browser, '.m-back')
  await browser.esperar(`location.pathname === '/board' && document.getElementById('m-card').hidden`)
  assert.equal(await browser.avaliar(`document.getElementById('m-title').textContent`), 'Quadro')
  assert.equal(await browser.avaliar(`document.getElementById('m-app').inert`), false)
})

test('do Quadro: tocar na linha abre o card e o voltar do sistema devolve a mesma coluna', { skip }, async () => {
  await browser.ir(`${fx.base}/board?c=doing`)
  await browser.esperar(`!!document.querySelector('.m-row[data-card="CARD-603"]')`)
  await tocar(browser, '.m-row[data-card="CARD-603"]')
  await browser.esperar(`location.pathname === '/card/CARD-603' && ${cardOpen}`)
  assert.equal(await browser.avaliar(`${q('.m-card-topid')}.textContent`), 'CARD-603')
  await browser.avaliar(`history.back()`)
  await browser.esperar(`location.pathname === '/board' && document.getElementById('m-card').hidden`)
  assert.equal(await browser.avaliar(`location.search`), '?c=doing')
  assert.equal(await browser.avaliar(`${q('.m-col-tab[aria-selected="true"]')}.dataset.col`), 'doing')
})

test('card que nao existe diz isso e oferece voltar', { skip }, async () => {
  await browser.ir(`${fx.base}/card/CARD-999`)
  await browser.esperar(`!document.getElementById('m-card').hidden && document.querySelector('#m-card .m-empty-title')?.textContent.includes('CARD-999')`)
  await tocar(browser, '#m-card .m-retry')
  await browser.esperar(`document.getElementById('m-card').hidden`)
})
