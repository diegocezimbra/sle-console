/**
 * Traducao do payload cru de hook para o envelope uniforme da secao 8 da spec.
 *
 * Uma unica forma entra no fluxo SSE, no JSONL e no indice em memoria. Cada
 * fonte nova traduz aqui e o resto do daemon nao muda.
 */

/**
 * Escala de tempo de cada evento -- e o que a regua de loops desenha.
 * L1 = turno (segundos) · L2 = etapa e sessao (minutos) · L3 = card (horas).
 */
const ESCALA = {
  'tool.pre': 'L1',
  'tool.post': 'L1',
  'prompt.submit': 'L1',
  'session.start': 'L2',
  'session.end': 'L2',
  'subagent.start': 'L2',
  'subagent.stop': 'L2',
  'turn.stop': 'L2',
  'compact.pre': 'L2',
  'card.move': 'L3',
  'gate.decide': 'L3',
}

const KIND = {
  PostToolUse: 'tool.post',
  PreToolUse: 'tool.pre',
  UserPromptSubmit: 'prompt.submit',
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  SubagentStart: 'subagent.start',
  SubagentStop: 'subagent.stop',
  Stop: 'turn.stop',
  PreCompact: 'compact.pre',
}

/** @returns {object|null} envelope, ou null quando nao da para atribuir. */
export function normalizar(cru, agora = new Date()) {
  if (!cru || typeof cru !== 'object') return null
  const session = cru.session_id
  // Sem sessao nao ha a quem atribuir, e evento anonimo suja o fluxo.
  if (!session) return null

  const evento = cru.hook_event_name ?? ''
  const kind = KIND[evento] ?? `hook.${evento.toLowerCase() || 'desconhecido'}`

  return {
    ts: agora.toISOString(),
    kind,
    loop: ESCALA[kind] ?? 'L1',
    card: cru.card ?? null,
    agent: vazioEhNulo(cru.agent_type ?? cru.agent),
    session,
    // Medido em 2026-09-04: o Claude Code manda `SubagentStop` com `agent`
    // vazio e sem `parent_agent` -- os campos que a spec prometia nao vem.
    // Sem este fallback o grafo de iteracao fica eternamente vazio.
    parent_agent: cru.parent_agent ?? (ehSubagente(evento) ? session : null),
    payload: corpo(kind, cru),
  }
}

const vazioEhNulo = (v) => (v == null || v === '' ? null : v)
const ehSubagente = (evento) => evento === 'SubagentStart' || evento === 'SubagentStop'

function corpo(kind, cru) {
  // `cwd` acompanha todo evento: e o que permite chamar a sessao pelo nome do
  // projeto em vez de por um uuid.
  if (kind === 'tool.post' || kind === 'tool.pre') {
    const entrada = cru.tool_input ?? {}
    return {
      cwd: cru.cwd ?? null,
      tool: cru.tool_name ?? null,
      file: entrada.file_path ?? null,
      command: entrada.command ?? null,
      ok: cru.tool_response ? cru.tool_response.success !== false : null,
      ms: cru.duration_ms ?? null,
    }
  }
  if (kind === 'prompt.submit') return { chars: (cru.prompt ?? '').length }
  return { cwd: cru.cwd ?? null }
}
