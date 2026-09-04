import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser

before(async () => {
  const projeto = mkdtempSync(join(tmpdir(), 'sle-ic-'))
  mkdirSync(join(projeto, 'sle', 'agents'), { recursive: true })
  const agente = (o) => writeFileSync(join(projeto, 'sle', 'agents', `${o.id}.json`), JSON.stringify(o))
  agente({ id: 'implementer', role: 'maker', comando: 'sleep 3', model: 'deepseek-v4-pro',
    provider: 'deepseek', stages: ['E4'], limits: { max_usd: 2 } })
  agente({ id: 'adversarial-reviewer', role: 'checker', comando: 'sleep 3',
    model: 'deepseek-v4-pro', provider: 'deepseek', can_approve_gates: ['G5'] })

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-icd-')), projeto, tetoDiarioUsd: 50 })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = async () => {
    await d.runner.pararTudo()
    return new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  }
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

const irParaControle = async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="controle"]').click()`)
  await browser.esperar(`document.querySelectorAll('#agentes .agente').length === 2`)
}

test('a tela lista cada agente com papel e modelo', { skip: pular }, async () => {
  await irParaControle()
  const t = await browser.avaliar(`document.getElementById('agentes').textContent`)
  assert.match(t, /implementer/)
  assert.match(t, /deepseek-v4-pro/)
  assert.match(t, /maker/)
})

test('maker e checker no mesmo modelo aparece em alerta', { skip: pular }, async () => {
  const alertas = await browser.avaliar(`document.querySelectorAll('#agentes .agente.alerta').length`)
  assert.equal(alertas, 2, 'o mesmo modelo tende a aprovar o proprio tipo de erro')
  const t = await browser.avaliar(`document.querySelector('#agentes .alerta').title`)
  assert.match(t, /mesmo modelo/i)
})

test('rodar um agente pela tela o coloca entre os ativos', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('[data-rodar="implementer"]').click()`)
  await browser.esperar(`document.getElementById('ativos').textContent.includes('implementer')`)
})

test('a parada de emergencia esvazia os ativos', { skip: pular }, async () => {
  await browser.avaliar(`document.getElementById('parada').click()`)
  await browser.esperar(`document.querySelectorAll('#ativos li.processo').length === 0`)
})

test('nenhum erro de JavaScript na tela de controle', { skip: pular }, async () => {
  assert.deepEqual(browser.erros, [], browser.erros.join(' | '))
})
