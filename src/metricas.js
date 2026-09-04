/**
 * As metricas da secao 14 do documento de metodo.
 *
 * Regra que atravessa o arquivo: **dado que nao chegou nao vira zero.** Toda
 * metrica devolve `{ valor, estado }`, e quando o valor e `null` o estado diz
 * por que -- "aguardando telemetria", "fora do console". Zero e uma afirmacao;
 * ausencia de dado nao e.
 */

const sem = (estado) => ({ valor: null, estado })
const com = (valor, estado = 'medido') => ({ valor, estado })

export function calcularMetricas(eventos) {
  const decisoes = eventos.filter((e) => e.kind === 'gate.decidido')
  const custos = eventos.filter((e) => e.kind === 'custo')

  const ferramentas = eventos.filter((e) => e.kind === 'tool.post')

  return {
    // ── o trabalho que está acontecendo ──────────────────────────────────
    // As métricas do método dependem do SLE estar em uso; estas medem o que
    // já está sendo capturado, para a tela não ficar vazia com mil eventos.
    atividadePorProjeto: atividadePorProjeto(ferramentas),
    ferramentasMaisUsadas: contarPor(ferramentas, (e) => e.payload?.tool),
    taxaDeFalhaDeComando: taxaDeFalha(ferramentas),
    picoDeSessoesSimultaneas: picoDeSessoes(eventos),

    // ── o método ─────────────────────────────────────────────────────────
    turnosPorCard: turnosPorCard(eventos),
    reprovacoesPorGate: reprovacoesPorGate(decisoes),
    gatesQueNuncaReprovam: gatesQueNuncaReprovam(decisoes),
    taxaDeEscalonamento: taxaDeEscalonamento(decisoes),
    tempoDeReviewHumano: tempoDeReviewHumano(decisoes),
    custoPorCard: custoPorCard(custos),

    // Estas duas dependem de dado que o console nao ve. Mentir seria pior.
    coberturaDeMutacao: sem('vem da suíte de mutação, fora do console'),
    changeFailureRate: sem('depende de incidentes em produção, fora do console'),
  }
}

function atividadePorProjeto(eventos) {
  const porProjeto = {}
  for (const e of eventos) {
    const cwd = e.payload?.cwd
    if (!cwd) continue
    const nome = String(cwd).split(/[/\\]/).filter(Boolean).pop()
    porProjeto[nome] = (porProjeto[nome] ?? 0) + 1
  }
  return Object.keys(porProjeto).length ? com(ordenar(porProjeto)) : sem('nenhum evento com projeto ainda')
}

function contarPor(eventos, chave) {
  const contagem = {}
  for (const e of eventos) {
    const k = chave(e)
    if (!k) continue
    contagem[k] = (contagem[k] ?? 0) + 1
  }
  return Object.keys(contagem).length ? com(ordenar(contagem)) : sem('nenhuma ferramenta usada ainda')
}

function taxaDeFalha(eventos) {
  const comResultado = eventos.filter((e) => e.payload?.ok != null)
  if (!comResultado.length) return sem('nenhum comando com resultado ainda')
  const falhas = comResultado.filter((e) => e.payload.ok === false).length
  return com(falhas / comResultado.length)
}

/** Quantos agentes trabalharam ao mesmo tempo, em janelas de 10 minutos. */
function picoDeSessoes(eventos) {
  if (!eventos.length) return sem('nenhum evento ainda')
  const janelas = new Map()
  for (const e of eventos) {
    if (!e.session) continue
    const janela = Math.floor(Date.parse(e.ts) / 600000)
    const set = janelas.get(janela) ?? new Set()
    set.add(e.session)
    janelas.set(janela, set)
  }
  if (!janelas.size) return sem('nenhuma sessão ainda')
  return com(Math.max(...[...janelas.values()].map((s) => s.size)))
}

/** Maior primeiro: a tela mostra os dez de cima. */
function ordenar(objeto) {
  return Object.fromEntries(
    Object.entries(objeto)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  )
}

function turnosPorCard(eventos) {
  const porCard = {}
  for (const e of eventos) {
    if (e.kind !== 'turn.stop' || !e.card) continue
    porCard[e.card] = (porCard[e.card] ?? 0) + 1
  }
  return Object.keys(porCard).length ? com(porCard) : sem('nenhum turno encerrado ainda')
}

function reprovacoesPorGate(decisoes) {
  if (!decisoes.length) return sem('nenhum gate decidido ainda')
  const porGate = {}
  for (const d of decisoes) {
    const g = (porGate[d.payload.gate] ??= {})
    g[d.payload.decisao] = (g[d.payload.decisao] ?? 0) + 1
  }
  return com(porGate)
}

/** Verificacao que nunca reprova esta quebrada ou e decoracao. */
function gatesQueNuncaReprovam(decisoes) {
  if (!decisoes.length) return sem('nenhum gate decidido ainda')
  const vistos = new Map()
  for (const d of decisoes) {
    const atual = vistos.get(d.payload.gate) ?? false
    vistos.set(d.payload.gate, atual || d.payload.decisao === 'reprovou')
  }
  return com([...vistos].filter(([, reprovou]) => !reprovou).map(([g]) => g))
}

function taxaDeEscalonamento(decisoes) {
  if (!decisoes.length) return sem('nenhum gate decidido ainda')
  const humanos = decisoes.filter((d) => d.payload.decisao === 'aguardando_humano').length
  return com(humanos / decisoes.length)
}

function tempoDeReviewHumano(decisoes) {
  const esperas = new Map()
  const tempos = []
  for (const d of decisoes) {
    const chave = `${d.payload.gate}:${d.payload.card ?? ''}`
    if (d.payload.decisao === 'aguardando_humano') esperas.set(chave, Date.parse(d.ts))
    else if (esperas.has(chave)) {
      tempos.push(Date.parse(d.ts) - esperas.get(chave))
      esperas.delete(chave)
    }
  }
  if (!tempos.length) return sem('nenhum gate humano decidido ainda')
  return com(Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length))
}

/**
 * O unico numero que importa de verdade: custo por entrega, nao por token.
 * Um modelo 20x mais barato que dobra as voltas ficou mais caro.
 */
function custoPorCard(custos) {
  if (!custos.length) return sem('aguardando flush de telemetria (OTel, até 60s)')
  const porCard = {}
  for (const c of custos) {
    const chave = c.card ?? 'sem-card'
    porCard[chave] = Number(((porCard[chave] ?? 0) + (c.payload.usd ?? 0)).toFixed(6))
  }
  return com(porCard)
}
