/**
 * O que aconteceu, por dia: o que foi entregue, quem trabalhou, quanto custou.
 *
 * Sai do mesmo JSONL append-only que alimenta tudo -- nao ha segunda fonte a
 * dessincronizar. **Entregue** e o card que chegou em `done`; card que andou
 * de coluna andou, e nao entregou.
 */
export function montarHistorico(eventos, { de = null, ate = null } = {}) {
  const dias = new Map()

  for (const e of eventos) {
    const data = (e.ts ?? '').slice(0, 10)
    if (!data) continue
    if (de && data < de) continue
    if (ate && data > ate) continue

    const dia = dias.get(data) ?? {
      data,
      entregues: [],
      movimentacoes: [],
      agentes: [],
      custoUsd: null,
      custoPorCard: {},
      reprovacoes: 0,
      eventos: 0,
    }
    dia.eventos++

    if (e.agent && !dia.agentes.includes(e.agent)) dia.agentes.push(e.agent)

    if (e.kind === 'card.move') {
      if (e.payload?.para === 'done') {
        if (!dia.entregues.includes(e.card)) dia.entregues.push(e.card)
      } else {
        dia.movimentacoes.push({ card: e.card, para: e.payload?.para })
      }
    }

    if (e.kind === 'custo') {
      const usd = Number(e.payload?.usd ?? 0)
      dia.custoUsd = Number(((dia.custoUsd ?? 0) + usd).toFixed(6))
      const chave = e.card ?? 'sem-card'
      dia.custoPorCard[chave] = Number(((dia.custoPorCard[chave] ?? 0) + usd).toFixed(6))
    }

    if (e.kind === 'gate.decidido' && e.payload?.decisao === 'reprovou') dia.reprovacoes++

    dias.set(data, dia)
  }

  return [...dias.values()].sort((a, b) => b.data.localeCompare(a.data))
}
