import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarHistorico } from '../src/historico.js'

const ev = (o) => ({ ts: o.ts, kind: o.kind, loop: 'L3', card: o.card ?? null,
  agent: o.agent ?? null, session: o.session ?? null, parent_agent: null, payload: o.payload ?? {} })

const eventos = [
  ev({ ts: '2026-09-03T09:00:00Z', kind: 'session.start', session: 's1', agent: 'implementer' }),
  ev({ ts: '2026-09-03T09:05:00Z', kind: 'tool.post', session: 's1', card: 'CARD-1' }),
  ev({ ts: '2026-09-03T09:30:00Z', kind: 'custo', session: 's1', card: 'CARD-1', payload: { usd: 2.5 } }),
  ev({ ts: '2026-09-03T10:00:00Z', kind: 'card.move', card: 'CARD-1', payload: { para: 'done' } }),
  ev({ ts: '2026-09-04T08:00:00Z', kind: 'custo', session: 's2', card: 'CARD-2', payload: { usd: 1.25 } }),
  ev({ ts: '2026-09-04T08:30:00Z', kind: 'gate.decidido', card: 'CARD-2',
       payload: { gate: 'GV2', decisao: 'reprovou' } }),
  ev({ ts: '2026-09-04T09:00:00Z', kind: 'card.move', card: 'CARD-2', payload: { para: 'review' } }),
]

test('agrupa por dia, do mais recente para o mais antigo', () => {
  const h = montarHistorico(eventos)
  assert.deepEqual(h.map((d) => d.data), ['2026-09-04', '2026-09-03'])
})

test('entregue e o card que chegou em done, e nao o que so andou', () => {
  const [hoje, ontem] = montarHistorico(eventos)
  assert.deepEqual(ontem.entregues, ['CARD-1'])
  assert.deepEqual(hoje.entregues, [], 'mover para review nao e entrega')
  assert.deepEqual(hoje.movimentacoes, [{ card: 'CARD-2', para: 'review' }])
})

test('custo do dia soma, e aparece por card', () => {
  const [hoje, ontem] = montarHistorico(eventos)
  assert.equal(ontem.custoUsd, 2.5)
  assert.equal(hoje.custoUsd, 1.25)
  assert.equal(ontem.custoPorCard['CARD-1'], 2.5)
})

test('cada dia lista os agentes que trabalharam nele', () => {
  const [, ontem] = montarHistorico(eventos)
  assert.deepEqual(ontem.agentes, ['implementer'])
})

test('reprovacoes do dia aparecem, porque e onde o tempo foi', () => {
  const [hoje] = montarHistorico(eventos)
  assert.equal(hoje.reprovacoes, 1)
})

test('dia sem custo diz que nao houve telemetria, e nao zero', () => {
  const h = montarHistorico([ev({ ts: '2026-09-05T10:00:00Z', kind: 'tool.post', session: 's3' })])
  assert.equal(h[0].custoUsd, null)
})

test('filtra por intervalo de datas', () => {
  const h = montarHistorico(eventos, { de: '2026-09-04' })
  assert.equal(h.length, 1)
  assert.equal(h[0].data, '2026-09-04')
})

test('sem eventos devolve lista vazia, nao um dia falso', () => {
  assert.deepEqual(montarHistorico([]), [])
})
