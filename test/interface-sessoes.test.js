/**
 * CARD-120c: cobertura de interface pro corte "trabalhando agora" -- o
 * pedaço de `web/app.js` (contador, seção "recentes" recolhida, régua) que
 * foi revisado no PR #7 por não ter teste nenhum.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser

const ev = (over) => ({
  ts: new Date().toISOString(), kind: 'tool.post', loop: 'L1', card: null,
  agent: null, session: 's', parent_agent: null, payload: { tool: 'Edit', ok: true }, ...over,
})

before(async () => {
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-sessoes-')) })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))

  const agora = Date.now()
  // Sessao parada há 3 dias registrada PRIMEIRO -- de propósito: o `fluxo`
  // do `Estado` é ordem de chegada, não ordem cronológica do `ts`, e a
  // régua usa `eventos[0]`/`eventos.at(-1)` pra achar as pontas do domínio.
  // Se ela não for filtrada, vira o `t0` (é o primeiro elemento do array) e
  // estica o domínio pra 3 dias, espremendo os 3 eventos da sessão ativa
  // a poucos pixels da borda direita.
  d.estado.registrar(ev({ session: 's-antiga', ts: new Date(agora - 72 * 3600_000).toISOString() }))
  // Sessao ativa: 3 eventos espalhados por 2s -- o suficiente pra régua
  // desenhar um traço perto do início, um no meio e um perto do fim, DESDE
  // QUE o domínio da régua seja calculado só com estes três.
  d.estado.registrar(ev({ session: 's-ativa', ts: new Date(agora - 2000).toISOString() }))
  d.estado.registrar(ev({ session: 's-ativa', ts: new Date(agora - 1000).toISOString() }))
  d.estado.registrar(ev({ session: 's-ativa', ts: new Date(agora).toISOString() }))

  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

test('o contador de Agentes conta so quem esta ativa', { skip: pular }, async () => {
  const texto = await browser.avaliar(`document.getElementById('sessoes-contagem').textContent`)
  assert.match(texto, /^1 trabalhando agora$/)
  const itens = await browser.avaliar(`document.querySelectorAll('#sessoes li').length`)
  assert.equal(itens, 1, 'so a sessao ativa entra na lista principal')
})

test('sessao parada vai para "recentes", recolhida por padrao', { skip: pular }, async () => {
  const painel = await browser.avaliar(`(() => {
    const p = document.getElementById('sessoes-recentes-painel')
    return { hidden: p.hidden, aberto: p.open }
  })()`)
  assert.equal(painel.hidden, false, 'com sessao parada, a secao aparece')
  assert.equal(painel.aberto, false, 'comeca recolhida -- não é <details open>')
  const contagem = await browser.avaliar(`document.getElementById('sessoes-recentes-contagem').textContent`)
  assert.equal(contagem, '1')
  const itens = await browser.avaliar(`document.querySelectorAll('#sessoes-recentes li').length`)
  assert.equal(itens, 1)
})

test('a regua so desenha traco de sessao ativa -- a antiga nao estica o dominio', { skip: pular }, async () => {
  // Se a sessão de 3 dias atrás entrasse no cálculo do domínio, os 3
  // eventos da sessão ativa (2s de intervalo real) ficariam todos
  // espremidos a poucos pixels da borda direita, e o terço do meio do
  // canvas ficaria em branco. Filtrado direito, o evento do meio da sessão
  // ativa cai perto do centro.
  const meioPintado = await browser.avaliar(`(() => {
    const c = document.getElementById('regua')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const x0 = Math.floor(c.width * 0.4)
    const x1 = Math.floor(c.width * 0.6)
    // Cor do traço L1 (#4aa3df), não a grade de fundo (#252a34, que cobre
    // a largura inteira e faria QUALQUER corte de x passar por engano).
    for (let y = 0; y < c.height; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * c.width + x) * 4
        if (Math.abs(d[i] - 74) < 20 && Math.abs(d[i + 1] - 163) < 20 && Math.abs(d[i + 2] - 223) < 20 && d[i + 3] > 0) return true
      }
    }
    return false
  })()`)
  assert.equal(meioPintado, true, 'o terço do meio da régua ficou em branco -- domínio esticado pela sessão antiga')
})
