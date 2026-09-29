import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOOKBACK_MS, insertIndex, sinceWithLookback, splitLate } from '../web/chat-order.js'

test('sinceWithLookback recua o carimbo para pegar retardatario do espelho', () => {
  const t = '2026-09-29T10:10:00.000Z'
  assert.equal(sinceWithLookback(t), new Date(Date.parse(t) - LOOKBACK_MS).toISOString())
  assert.equal(sinceWithLookback(t, 60_000), '2026-09-29T10:09:00.000Z')
})

test('sinceWithLookback devolve o carimbo como veio se nao for data', () => {
  assert.equal(sinceWithLookback(''), '')
  assert.equal(sinceWithLookback('lixo'), 'lixo')
})

test('splitLate separa o que vem depois do fim (append) do retardatario (entra no meio), cada grupo em ordem de ts', () => {
  const novas = [
    { id: 'c', ts: '2026-09-29T10:06:00Z' },
    { id: 'a', ts: '2026-09-29T10:01:00Z' },
    { id: 'd', ts: '2026-09-29T10:07:00Z' },
    { id: 'b', ts: '2026-09-29T10:04:00Z' },
  ]
  const { tail, late } = splitLate(novas, '2026-09-29T10:05:00Z')
  assert.deepEqual(tail.map((x) => x.id), ['c', 'd'])
  assert.deepEqual(late.map((x) => x.id), ['a', 'b'])
})

test('splitLate: ts igual ao ultimo visto e retardatario (nao repete no fim)', () => {
  const { tail, late } = splitLate([{ id: 'x', ts: '2026-09-29T10:05:00Z' }], '2026-09-29T10:05:00Z')
  assert.equal(tail.length, 0)
  assert.equal(late.length, 1)
})

test('insertIndex acha a posicao antes da primeira mais nova, ou o fim', () => {
  const ts = ['2026-09-29T10:00:00Z', '2026-09-29T10:05:00Z', '2026-09-29T10:10:00Z']
  assert.equal(insertIndex(ts, '2026-09-29T09:00:00Z'), 0)
  assert.equal(insertIndex(ts, '2026-09-29T10:03:00Z'), 1)
  assert.equal(insertIndex(ts, '2026-09-29T10:05:00Z'), 2, 'empate entra depois (estavel)')
  assert.equal(insertIndex(ts, '2026-09-29T11:00:00Z'), 3)
  assert.equal(insertIndex([], '2026-09-29T11:00:00Z'), 0)
})
