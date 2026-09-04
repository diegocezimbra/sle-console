import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

let base, fechar, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-ctl-'))
  mkdirSync(join(projeto, 'sle', 'agents'), { recursive: true })
  mkdirSync(join(projeto, 'sle', 'gates'), { recursive: true })
  writeFileSync(join(projeto, 'sle', 'agents', 'implementer.json'), JSON.stringify({
    id: 'implementer', role: 'maker', comando: 'sleep 4', stages: ['E4'],
    provider: 'deepseek', model: 'deepseek-v4-pro', limits: { max_minutes: 1, max_usd: 2 },
  }))
  writeFileSync(join(projeto, 'sle', 'gates', 'pipeline.json'), JSON.stringify({
    stages: [], gates: [{ id: 'GV2', name: 'Suite', after: 'V2', mode: 'auto',
      verify: { type: 'command', run: 'exit 0' } }],
  }))
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-ctld-')), projeto, tetoDiarioUsd: 50 })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = async () => {
    await fetch(`${base}/api/emergency-stop`, { method: 'POST' })
    return new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  }
})
after(async () => { await fechar?.() })

test('lista os agentes configurados, com modelo e papel', async () => {
  const j = await (await fetch(`${base}/api/agents`)).json()
  const a = j.agentes.find((x) => x.id === 'implementer')
  assert.equal(a.model, 'deepseek-v4-pro')
  assert.equal(a.role, 'maker')
})

test('roda um agente pelo id e ele aparece como ativo', async () => {
  const r = await fetch(`${base}/api/agents/implementer/run`, { method: 'POST' })
  assert.equal(r.status, 200)
  const j = await (await fetch(`${base}/api/agents`)).json()
  assert.equal(j.ativos.length, 1)
  assert.equal(j.ativos[0].agente, 'implementer')
})

test('agente inexistente devolve 404 em vez de rodar qualquer coisa', async () => {
  const r = await fetch(`${base}/api/agents/nao-existe/run`, { method: 'POST' })
  assert.equal(r.status, 404)
})

test('nao existe endpoint que aceite um comando arbitrario', async () => {
  const r = await fetch(`${base}/api/agents/implementer/run`, {
    method: 'POST', body: JSON.stringify({ comando: 'touch /tmp/invadido-sle' }),
  })
  const j = await r.json()
  assert.doesNotMatch(JSON.stringify(j), /invadido/, 'o comando so pode vir da configuracao')
})

test('a parada de emergencia mata tudo e responde quantos', async () => {
  const j = await (await fetch(`${base}/api/emergency-stop`, { method: 'POST' })).json()
  assert.ok(j.mortos >= 1)
  const depois = await (await fetch(`${base}/api/agents`)).json()
  assert.equal(depois.ativos.length, 0)
})

test('o gate e decidido pelo daemon, com o resultado real do comando', async () => {
  const j = await (await fetch(`${base}/api/gates/GV2/decide`, {
    method: 'POST', body: JSON.stringify({ card: { id: 'CARD-1', risk: 'baixo' } }),
  })).json()
  assert.equal(j.decisao, 'passou')
})

test('gate inexistente nao e inventado', async () => {
  const r = await fetch(`${base}/api/gates/NAO-EXISTE/decide`, { method: 'POST', body: '{}' })
  assert.equal(r.status, 404)
})
