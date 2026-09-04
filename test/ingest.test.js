import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizar } from '../src/ingest.js'

// O envelope uniforme da secao 8 da spec. Tudo que entra vira isto, ou nada.
const base = { session_id: 'abc123', cwd: '/repo' }

test('PostToolUse de edicao vira tool.post com arquivo e duracao', () => {
  const e = normalizar({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'core/auth/TokenStore.kt' },
    tool_response: { success: true },
    duration_ms: 412,
  })
  assert.equal(e.kind, 'tool.post')
  assert.equal(e.session, 'abc123')
  assert.equal(e.payload.tool, 'Edit')
  assert.equal(e.payload.file, 'core/auth/TokenStore.kt')
  assert.equal(e.payload.ok, true)
  assert.equal(e.payload.ms, 412)
  assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T/)
})

test('falha de ferramenta e registrada como falha, nao como sucesso', () => {
  const e = normalizar({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'npm test' }, tool_response: { success: false } })
  assert.equal(e.payload.ok, false)
})

test('SessionStart e SessionEnd acendem e apagam o agente', () => {
  assert.equal(normalizar({ ...base, hook_event_name: 'SessionStart' }).kind, 'session.start')
  assert.equal(normalizar({ ...base, hook_event_name: 'SessionEnd' }).kind, 'session.end')
})

test('subagente carrega o pai, que e o que desenha o grafo', () => {
  const e = normalizar({ ...base, hook_event_name: 'SubagentStart',
    agent_id: 'sub-1', agent_type: 'adversarial-reviewer', parent_agent: 'abc123' })
  assert.equal(e.kind, 'subagent.start')
  assert.equal(e.agent, 'adversarial-reviewer')
  assert.equal(e.parent_agent, 'abc123')
})

test('cada evento sabe em que escala de tempo vive (a regua de loops)', () => {
  const loopDe = (p) => normalizar({ ...base, ...p }).loop
  assert.equal(loopDe({ hook_event_name: 'PostToolUse', tool_name: 'Read' }), 'L1', 'turno')
  assert.equal(loopDe({ hook_event_name: 'Stop' }), 'L2', 'etapa')
  assert.equal(loopDe({ hook_event_name: 'SessionStart' }), 'L2')
})

test('todo evento carrega o cwd: e o que da nome ao projeto no painel', () => {
  const e = normalizar({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'a.ts' } })
  assert.equal(e.payload.cwd, '/repo')
})

test('payload sem sessao e descartado em vez de virar evento anonimo', () => {
  assert.equal(normalizar({ hook_event_name: 'PostToolUse' }), null)
  assert.equal(normalizar(null), null)
})

test('evento desconhecido nao derruba a ingestao', () => {
  const e = normalizar({ ...base, hook_event_name: 'AlgoQueAindaNaoExiste' })
  assert.equal(e.kind, 'hook.algoqueaindanaoexiste')
})

test('o card sai do cwd quando ha um card em foco, senao fica nulo', () => {
  const e = normalizar({ ...base, hook_event_name: 'Stop' })
  assert.equal(e.card, null)
})

// ── o que o Claude Code REALMENTE manda em subagente ────────────────────────
// Medido em 2026-09-04: `SubagentStop` chega com `agent` vazio e sem
// `parent_agent`. A spec prometia `agent_id`/`agent_type`; não vêm.

test('agente vazio vira nulo, e nao um agente de nome ""', () => {
  const e = normalizar({ session_id: 's1', cwd: '/r', hook_event_name: 'SubagentStop', agent_type: '' })
  assert.equal(e.agent, null)
})

test('subagent.stop sem pai declarado usa a propria sessao como pai', () => {
  // É o que dá para saber: a sessão que reportou o fim lançou o subagente.
  const e = normalizar({ session_id: 'pai-1', cwd: '/r', hook_event_name: 'SubagentStop' })
  assert.equal(e.kind, 'subagent.stop')
  assert.equal(e.parent_agent, 'pai-1', 'sem isto o grafo fica eternamente vazio')
})

test('quando o pai vem declarado, ele e respeitado', () => {
  const e = normalizar({ session_id: 'filho', cwd: '/r', hook_event_name: 'SubagentStart',
    parent_agent: 'pai-real', agent_type: 'reviewer' })
  assert.equal(e.parent_agent, 'pai-real')
  assert.equal(e.agent, 'reviewer')
})
