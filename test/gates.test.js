import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decidirGate } from '../src/gates.js'

const proj = () => mkdtempSync(join(tmpdir(), 'sle-gate-'))
const card = (over = {}) => ({ id: 'CARD-1', risk: 'baixo', ...over })

test('gate automatico que passa libera a etapa', async () => {
  const g = { id: 'GV2', name: 'Suite', after: 'V2', mode: 'auto',
    verify: { type: 'command', run: 'exit 0' } }
  const d = await decidirGate(proj(), g, card())
  assert.equal(d.decisao, 'passou')
})

test('gate automatico que falha devolve ao agente com o motivo', async () => {
  const g = { id: 'GV2', name: 'Suite', after: 'V2', mode: 'auto',
    verify: { type: 'command', run: 'echo 3 testes quebrados 1>&2; exit 1' } }
  const d = await decidirGate(proj(), g, card())
  assert.equal(d.decisao, 'reprovou')
  assert.match(d.motivo, /3 testes quebrados/, 'devolver sem o motivo e mandar tentar de novo no escuro')
})

test('gate humano nao decide sozinho: fica esperando', async () => {
  const d = await decidirGate(proj(), { id: 'G1', name: 'Req', after: 'E1', mode: 'human' }, card())
  assert.equal(d.decisao, 'aguardando_humano')
})

test('auto_unless vira humano quando a condicao bate', async () => {
  const g = { id: 'G3', name: 'Vermelhos', after: 'E4', mode: 'auto_unless',
    condition: "card.risk == 'alto'", verify: { type: 'command', run: 'exit 0' } }
  assert.equal((await decidirGate(proj(), g, card({ risk: 'alto' }))).decisao, 'aguardando_humano')
  assert.equal((await decidirGate(proj(), g, card({ risk: 'baixo' }))).decisao, 'passou')
})

test('advisory registra a falha mas nao bloqueia: e o modo de rodar gate novo', async () => {
  const g = { id: 'GX', name: 'Novo', after: 'E5', mode: 'advisory',
    verify: { type: 'command', run: 'exit 1' } }
  const d = await decidirGate(proj(), g, card())
  assert.equal(d.decisao, 'passou')
  assert.equal(d.observacao, 'reprovou')
})

test('gate sem verify em modo automatico e invalido, e para o pipeline', async () => {
  const d = await decidirGate(proj(), { id: 'GZ', name: 'Sem', after: 'E1', mode: 'auto' }, card())
  assert.equal(d.decisao, 'invalido')
  assert.match(d.motivo, /verify/)
})

test('gate quebrado falha fechado: nao deixa passar sem verificar', async () => {
  const g = { id: 'GY', name: 'Ruim', after: 'E1', mode: 'auto',
    verify: { type: 'inexistente', run: 'x' } }
  const d = await decidirGate(proj(), g, card())
  assert.equal(d.decisao, 'invalido')
  assert.notEqual(d.decisao, 'passou', 'falha fechada, nunca aberta')
})

test('expectativa de falha e suportada: o TDD vermelho tem de falhar', async () => {
  const g = { id: 'G3', name: 'Vermelhos', after: 'E4', mode: 'auto',
    verify: { type: 'command', run: 'exit 1', expect: 'exit != 0' } }
  assert.equal((await decidirGate(proj(), g, card())).decisao, 'passou')

  const verde = { ...g, verify: { ...g.verify, run: 'exit 0' } }
  const d = await decidirGate(proj(), verde, card())
  assert.equal(d.decisao, 'reprovou', 'teste que passa na etapa vermelha e teste que nao prova nada')
})

test('condicao maliciosa nao vira execucao de codigo', async () => {
  const g = { id: 'GM', name: 'X', after: 'E1', mode: 'auto_unless',
    condition: "process.exit(1)", verify: { type: 'command', run: 'exit 0' } }
  const d = await decidirGate(proj(), g, card())
  assert.equal(d.decisao, 'passou', 'condicao que nao casa o formato conhecido e ignorada, nao avaliada')
})
