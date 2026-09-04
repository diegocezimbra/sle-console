import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Estado } from '../src/estado.js'

const dir = () => mkdtempSync(join(tmpdir(), 'sle-'))
const ev = (over = {}) => ({
  ts: new Date().toISOString(), kind: 'tool.post', loop: 'L1', card: null,
  agent: null, session: 's1', parent_agent: null,
  payload: { tool: 'Edit', file: 'a.ts', ok: true, ms: 10 }, ...over,
})

test('o disco e a verdade: todo evento vai para o JSONL append-only', () => {
  const d = dir()
  const e = new Estado(d)
  e.registrar(ev())
  e.registrar(ev({ session: 's2' }))
  const linhas = readFileSync(join(d, 'events.jsonl'), 'utf8').trim().split('\n')
  assert.equal(linhas.length, 2)
  assert.equal(JSON.parse(linhas[1]).session, 's2')
})

test('o snapshot conhece as sessoes vivas e o que cada uma fez', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'session.start', session: 's1' }))
  e.registrar(ev({ session: 's1' }))
  e.registrar(ev({ session: 's1' }))
  const s = e.snapshot()
  assert.equal(s.sessoes.length, 1)
  assert.equal(s.sessoes[0].id, 's1')
  assert.equal(s.sessoes[0].eventos, 3)
  assert.equal(s.sessoes[0].ativa, true)
})

test('SessionEnd apaga o agente no painel', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'session.start' }))
  e.registrar(ev({ kind: 'session.end' }))
  assert.equal(e.snapshot().sessoes[0].ativa, false)
})

test('evento de sistema nao vira sessao fantasma no painel de agentes', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'session.start', session: 's1' }))
  e.registrar(ev({ kind: 'gate.decidido', session: null, payload: { gate: 'G1', decisao: 'passou' } }))
  e.registrar(ev({ kind: 'card.move', session: null, card: 'CARD-1', payload: { para: 'done' } }))

  const s = e.snapshot()
  assert.equal(s.sessoes.length, 1, 'decisao de gate nao e um agente')
  assert.equal(s.sessoes[0].id, 's1')
  assert.equal(s.fluxo.length, 3, 'mas os eventos continuam no fluxo')
})

test('o fluxo guarda os ultimos eventos, sem crescer para sempre', () => {
  const e = new Estado(dir(), { janela: 3 })
  for (let i = 0; i < 10; i++) e.registrar(ev({ payload: { tool: `T${i}` } }))
  const f = e.snapshot().fluxo
  assert.equal(f.length, 3)
  assert.equal(f.at(-1).payload.tool, 'T9', 'o mais recente por ultimo')
})

test('falha de ferramenta aparece separada no contador', () => {
  const e = new Estado(dir())
  e.registrar(ev({ payload: { tool: 'Bash', ok: false } }))
  e.registrar(ev({ payload: { tool: 'Bash', ok: true } }))
  assert.equal(e.snapshot().contadores.falhas, 1)
})

test('o grafo de agentes sai das arestas pai-filho', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'subagent.start', session: 'sub', agent: 'reviewer', parent_agent: 's1' }))
  const g = e.snapshot().grafo
  assert.deepEqual(g, [{ de: 's1', para: 'sub', agente: 'reviewer' }])
})

test('reinicio nao perde historia: o estado remonta do JSONL', () => {
  const d = dir()
  const um = new Estado(d)
  um.registrar(ev({ kind: 'session.start', session: 's9' }))
  const dois = new Estado(d)
  assert.equal(dois.snapshot().sessoes[0].id, 's9')
})

test('linha corrompida no JSONL nao cega o daemon', () => {
  const d = dir()
  new Estado(d).registrar(ev({ session: 'boa' }))
  appendFileSync(join(d, 'events.jsonl'), '{quebrado\n')
  assert.equal(new Estado(d).snapshot().sessoes[0].id, 'boa')
})
