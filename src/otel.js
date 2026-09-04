/**
 * Receptor OTLP minimo -- so o que interessa: custo e tokens por sessao.
 *
 * Aceita **OTLP/HTTP em JSON** (`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`).
 * Protobuf exigiria uma dependencia, e a regra do projeto e nao ter nenhuma;
 * JSON e um formato oficial do protocolo, entao nao ha nada a perder.
 */
const INTERESSA = {
  'claude_code.cost.usage': 'custo',
  'claude_code.token.usage': 'tokens',
}

export function extrairMedidas(corpo) {
  const medidas = []
  const recursos = corpo?.resourceMetrics
  if (!Array.isArray(recursos)) return medidas

  for (const recurso of recursos) {
    for (const escopo of recurso?.scopeMetrics ?? []) {
      for (const metrica of escopo?.metrics ?? []) {
        const tipo = INTERESSA[metrica?.name]
        if (!tipo) continue
        const pontos = metrica.sum?.dataPoints ?? metrica.gauge?.dataPoints ?? []
        for (const ponto of pontos) {
          const session = atributo(ponto, 'session.id')
          // Sem sessao nao da para ligar o custo a um agente nem a um card.
          if (!session) continue
          const valor = ponto.asDouble ?? ponto.asInt ?? 0
          medidas.push(
            tipo === 'custo'
              ? { tipo, session, usd: Number(valor) }
              : { tipo, session, quantidade: Number(valor) }
          )
        }
      }
    }
  }
  return medidas
}

function atributo(ponto, chave) {
  const achado = (ponto?.attributes ?? []).find((a) => a.key === chave)
  return achado?.value?.stringValue ?? null
}
