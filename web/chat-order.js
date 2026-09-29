/**
 * Ordem do chat no navegador, sem DOM (testavel em node).
 *
 * O espelho da sessao DEUS publica cada frase com o ts de quando foi dita, mas
 * a publicacao pode atrasar (fila local, index.lock, rede). A tela busca
 * `desde=<ultimo ts>`; sem uma janela de recuo, o retardatario nunca aparece e
 * a conversa fica com buraco ate recarregar a pagina.
 */
export const LOOKBACK_MS = 5 * 60 * 1000

/** Carimbo de onde reconsultar: um pouco antes do ultimo visto. Nao e data: devolve como veio. */
export function sinceWithLookback(lastTs, lookbackMs = LOOKBACK_MS) {
  const t = Date.parse(lastTs)
  return Number.isNaN(t) ? lastTs : new Date(t - lookbackMs).toISOString()
}

const byTs = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)

/** `tail` vai para o fim da tela; `late` (ts <= ultimo visto) entra no meio, no lugar certo. Cada grupo em ordem de ts. */
export function splitLate(novas, lastTs) {
  const ordenadas = novas.slice().sort(byTs)
  return {
    tail: ordenadas.filter((m) => m.ts > lastTs),
    late: ordenadas.filter((m) => m.ts <= lastTs),
  }
}

/** Posicao em `timestamps` (ordenados) antes da primeira mais nova que `ts`; empate entra depois (estavel). */
export function insertIndex(timestamps, ts) {
  const i = timestamps.findIndex((t) => t > ts)
  return i === -1 ? timestamps.length : i
}
