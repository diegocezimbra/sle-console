import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarPrioridade, pesoPrioridade, ordenarPorPrioridade } from '../src/prioridade.js'

test('normalizarPrioridade aceita o formato P<n> direto, inclusive negativo', () => {
  assert.equal(normalizarPrioridade('P0'), 'P0')
  assert.equal(normalizarPrioridade('p1'), 'P1')
  assert.equal(normalizarPrioridade('P-1'), 'P-1')
})

test('normalizarPrioridade mapeia os textos legados', () => {
  assert.equal(normalizarPrioridade('urgente'), 'P0')
  assert.equal(normalizarPrioridade('altissima'), 'P0')
  assert.equal(normalizarPrioridade('alta'), 'P1')
  assert.equal(normalizarPrioridade('media'), 'P2')
})

test('normalizarPrioridade: sem valor ou texto desconhecido vira P3', () => {
  assert.equal(normalizarPrioridade(undefined), 'P3')
  assert.equal(normalizarPrioridade(null), 'P3')
  assert.equal(normalizarPrioridade(''), 'P3')
  assert.equal(normalizarPrioridade('bagunca'), 'P3')
})

test('pesoPrioridade: P-1 pesa menos que P0, que pesa menos que P1', () => {
  assert.ok(pesoPrioridade('P-1') < pesoPrioridade('P0'))
  assert.ok(pesoPrioridade('P0') < pesoPrioridade('P1'))
  assert.ok(pesoPrioridade('P1') < pesoPrioridade('P2'))
})

test('ordenarPorPrioridade ordena P-1..Pn e joga sem-P (P3) pro fim', () => {
  const cards = [
    { id: 'a', prioridade: 'P2' },
    { id: 'b' }, // sem prioridade
    { id: 'c', prioridade: 'urgente' },
    { id: 'd', prioridade: 'P-1' },
    { id: 'e', prioridade: 'alta' },
  ]
  const ordem = ordenarPorPrioridade(cards).map((c) => c.id)
  assert.deepEqual(ordem, ['d', 'c', 'e', 'a', 'b'])
})

test('ordenarPorPrioridade e estavel entre cards do mesmo P', () => {
  const cards = [
    { id: 'a', prioridade: 'P1' },
    { id: 'b', prioridade: 'P1' },
    { id: 'c', prioridade: 'P1' },
  ]
  assert.deepEqual(ordenarPorPrioridade(cards).map((c) => c.id), ['a', 'b', 'c'])
})

test('ordenarPorPrioridade nao muda o array original', () => {
  const cards = [{ id: 'a', prioridade: 'P2' }, { id: 'b', prioridade: 'P0' }]
  const original = [...cards]
  ordenarPorPrioridade(cards)
  assert.deepEqual(cards, original)
})
