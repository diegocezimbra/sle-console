import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularMetricas } from '../src/metricas.js'

const ev = (o) => ({ ts: o.ts ?? '2026-09-04T10:00:00.000Z', kind: 'tool.post', loop: 'L1',
  card: null, agent: null, session: 's1', parent_agent: null, payload: {}, ...o })

test('turnos por card sai dos fins de turno, agrupados', () => {
  const m = calcularMetricas([
    ev({ kind: 'turn.stop', card: 'CARD-1' }),
    ev({ kind: 'turn.stop', card: 'CARD-1' }),
    ev({ kind: 'turn.stop', card: 'CARD-2' }),
  ])
  assert.equal(m.turnosPorCard.valor['CARD-1'], 2)
  assert.equal(m.turnosPorCard.valor['CARD-2'], 1)
})

test('reprovacoes por gate mostram qual verificacao pega de verdade', () => {
  const m = calcularMetricas([
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'passou' } }),
  ])
  assert.deepEqual(m.reprovacoesPorGate.valor.GV2, { reprovou: 2, passou: 1 })
})

test('gate que nunca reprovou e sinalizado: ou esta quebrado ou e decoracao', () => {
  const m = calcularMetricas([
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
  ])
  assert.deepEqual(m.gatesQueNuncaReprovam.valor, ['G1'])
})

test('custo por card soma a telemetria, e nao inventa', () => {
  const m = calcularMetricas([
    ev({ kind: 'custo', card: 'CARD-1', payload: { usd: 1.5 } }),
    ev({ kind: 'custo', card: 'CARD-1', payload: { usd: 2.25 } }),
  ])
  assert.equal(m.custoPorCard.valor['CARD-1'], 3.75)
})

test('sem telemetria de custo o painel diz que esta esperando, e nao zero', () => {
  const m = calcularMetricas([ev({ kind: 'turn.stop', card: 'CARD-1' })])
  assert.equal(m.custoPorCard.valor, null)
  assert.match(m.custoPorCard.estado, /aguardando/i)
})

test('taxa de escalonamento e a fracao de gates que pararam para humano', () => {
  const m = calcularMetricas([
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'aguardando_humano' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
  ])
  assert.equal(m.taxaDeEscalonamento.valor, 0.25)
})

test('tempo de review humano mede da espera ate a decisao', () => {
  const m = calcularMetricas([
    ev({ ts: '2026-09-04T10:00:00.000Z', kind: 'gate.decidido',
      payload: { gate: 'G1', card: 'CARD-1', decisao: 'aguardando_humano' } }),
    ev({ ts: '2026-09-04T10:12:00.000Z', kind: 'gate.decidido',
      payload: { gate: 'G1', card: 'CARD-1', decisao: 'passou', por: 'humano' } }),
  ])
  assert.equal(m.tempoDeReviewHumano.valor, 12 * 60000)
})

test('metrica que depende de dado que o console nao tem diz isso em voz alta', () => {
  const m = calcularMetricas([])
  assert.equal(m.coberturaDeMutacao.valor, null)
  assert.match(m.coberturaDeMutacao.estado, /fora do console/i)
  assert.equal(m.changeFailureRate.valor, null)
  assert.match(m.changeFailureRate.estado, /produção|producao/i)
})

test('lista vazia nao estoura e devolve todas as metricas em estado explicito', () => {
  const m = calcularMetricas([])
  for (const [nome, v] of Object.entries(m)) {
    assert.ok('valor' in v && 'estado' in v, `${nome} precisa dizer valor e estado`)
  }
})
