/**
 * O disco e a verdade; isto aqui e um indice descartavel sobre ele.
 *
 * Todo evento vai para um JSONL append-only e so depois atualiza a memoria.
 * Apagar o indice e reiniciar o daemon reconstroi tudo -- e por isso que nao
 * existe banco: seria uma segunda fonte para dessincronizar.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export class Estado {
  #janela

  #ttlMs

  constructor(dir, { janela = 200, ttlMs = 15 * 60000 } = {}) {
    mkdirSync(dir, { recursive: true })
    this.arquivo = join(dir, 'events.jsonl')
    this.#janela = janela
    this.#ttlMs = ttlMs
    this.sessoes = new Map()
    this.fluxo = []
    this.grafo = []
    this.contadores = { eventos: 0, falhas: 0 }
    this.#remontar()
  }

  registrar(evento) {
    appendFileSync(this.arquivo, JSON.stringify(evento) + '\n')
    this.#aplicar(evento)
    return evento
  }

  /** Todos os eventos do disco -- as metricas olham a historia, nao a janela. */
  todos() {
    try {
      return readFileSync(this.arquivo, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  snapshot() {
    const agora = Date.now()
    return {
      // Sessao viva e a que deu sinal ha pouco. Quase nenhuma manda
      // `SessionEnd`, entao esperar por ele enche o painel de fantasmas e
      // esconde quem esta trabalhando de verdade.
      sessoes: [...this.sessoes.values()]
        .map((s) => ({
          ...s,
          ativa: s.ativa && agora - Date.parse(s.ultimo) < this.#ttlMs,
          inativoMs: agora - Date.parse(s.ultimo),
        }))
        .sort((a, b) => b.ultimo.localeCompare(a.ultimo)),
      fluxo: this.fluxo,
      grafo: this.grafo,
      contadores: this.contadores,
    }
  }

  #aplicar(e) {
    this.contadores.eventos++
    if (e.payload?.ok === false) this.contadores.falhas++

    this.fluxo.push(e)
    if (this.fluxo.length > this.#janela) this.fluxo.shift()

    if (e.kind === 'subagent.start' && e.parent_agent) {
      this.grafo.push({ de: e.parent_agent, para: e.session, agente: e.agent })
    }

    // Evento de sistema (decisao de gate, movimentacao de card) nao tem sessao,
    // e nao pode virar um agente fantasma no painel.
    if (!e.session) return

    const s = this.sessoes.get(e.session) ?? {
      id: e.session, agente: e.agent, projeto: null, ativa: true, eventos: 0,
      inicio: e.ts, ultimo: e.ts,
    }
    // UUID nao diz nada; o nome do projeto diz tudo.
    const cwd = e.payload?.cwd
    if (cwd) s.projeto = String(cwd).split(/[/\\]/).filter(Boolean).pop() ?? null
    s.eventos++
    s.ultimo = e.ts
    if (e.agent) s.agente = e.agent
    if (e.kind === 'session.end') s.ativa = false
    if (e.kind === 'session.start') s.ativa = true
    this.sessoes.set(e.session, s)
  }

  #remontar() {
    let bruto
    try {
      bruto = readFileSync(this.arquivo, 'utf8')
    } catch {
      return // primeiro boot: nao ha o que remontar
    }
    for (const linha of bruto.split('\n')) {
      if (!linha.trim()) continue
      try {
        this.#aplicar(JSON.parse(linha))
      } catch {
        // Uma linha ruim nao pode cegar o daemon inteiro.
      }
    }
  }
}
