import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extrairMedidas } from '../src/otel.js'

const payload = (nome, valor, sessao) => ({
  resourceMetrics: [{
    scopeMetrics: [{
      metrics: [{
        name: nome,
        sum: { dataPoints: [{ asDouble: valor,
          attributes: [{ key: 'session.id', value: { stringValue: sessao } }] }] },
      }],
    }],
  }],
})

test('custo vira medida com sessao e valor', () => {
  const m = extrairMedidas(payload('claude_code.cost.usage', 0.42, 'abc123'))
  assert.equal(m.length, 1)
  assert.equal(m[0].tipo, 'custo')
  assert.equal(m[0].usd, 0.42)
  assert.equal(m[0].session, 'abc123')
})

test('tokens tambem sao capturados, como inteiro', () => {
  const p = payload('claude_code.token.usage', 1530, 'abc123')
  p.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asInt = 1530
  delete p.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asDouble
  const m = extrairMedidas(p)
  assert.equal(m[0].tipo, 'tokens')
  assert.equal(m[0].quantidade, 1530)
})

test('metrica que nao interessa e ignorada em silencio', () => {
  assert.deepEqual(extrairMedidas(payload('outra.coisa', 1, 's')), [])
})

test('payload sem sessao nao vira medida anonima', () => {
  const p = payload('claude_code.cost.usage', 1, 'x')
  p.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].attributes = []
  assert.deepEqual(extrairMedidas(p), [])
})

test('payload malformado devolve lista vazia em vez de estourar', () => {
  assert.deepEqual(extrairMedidas(null), [])
  assert.deepEqual(extrairMedidas({}), [])
  assert.deepEqual(extrairMedidas({ resourceMetrics: 'nao e lista' }), [])
})

test('varios pontos no mesmo envio viram varias medidas', () => {
  const p = payload('claude_code.cost.usage', 0.1, 's1')
  p.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints.push({
    asDouble: 0.3, attributes: [{ key: 'session.id', value: { stringValue: 's2' } }],
  })
  const m = extrairMedidas(p)
  assert.equal(m.length, 2)
  assert.equal(m[1].session, 's2')
})
