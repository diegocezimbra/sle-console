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
