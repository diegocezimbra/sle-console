/**
 * Roda os agentes -- a unica parte do daemon que executa processo.
 *
 * Regra que define o desenho: **o comando vem da configuracao, nunca da
 * requisicao.** A API aceita o id de um agente, e nada mais. Um endpoint que
 * aceitasse comando seria execucao remota de codigo com nome bonito.
 */
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Mata o processo e toda a descendencia dele. */
function matarGrupo(proc) {
  try {
    process.kill(-proc.pid, 'SIGKILL')
  } catch {
    try {
      proc.kill('SIGKILL')
    } catch {
      /* ja morreu */
    }
  }
}

export class Runner {
  #projeto
  #tetoDiarioUsd
  #gasto = 0
  #processos = new Map()
  #historico = []
  #proximo = 0

  constructor(projeto, { tetoDiarioUsd = Infinity } = {}) {
    this.#projeto = projeto
    this.#tetoDiarioUsd = tetoDiarioUsd
  }

  agentes() {
    const dir = join(this.#projeto, 'sle', 'agents')
    try {
      return readdirSync(dir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => {
          try {
            return JSON.parse(readFileSync(join(dir, n), 'utf8'))
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  async iniciar(id) {
    const agente = this.agentes().find((a) => a.id === id)
    if (!agente) return { ok: false, erro: `agente "${id}" nao existe na configuracao` }

    // Teto conservador: recusa o que PODE estourar, e nao o que ja estourou.
    // Descobrir que passou do teto depois de gastar e descobrir tarde demais.
    const previsto = agente.limits?.max_usd ?? 0
    if (this.#gasto + previsto > this.#tetoDiarioUsd) {
      return {
        ok: false,
        erro: `teto de gasto diario: ${this.#gasto} USD gastos + ${previsto} previstos passam de ${this.#tetoDiarioUsd}`,
      }
    }
    if (!agente.comando) return { ok: false, erro: `agente "${id}" nao declara comando` }

    const env = { ...process.env }
    // Cada agente com seu modelo: o ambiente e por processo, e nao global.
    if (agente.model) env.ANTHROPIC_MODEL = agente.model
    if (agente.small_model?.model) env.ANTHROPIC_SMALL_FAST_MODEL = agente.small_model.model
    if (agente.provider) env.SLE_PROVIDER = agente.provider

    // `detached` cria um grupo de processos proprio: matar o grupo alcanca os
    // netos. Sem isso, um agente que abre outro processo sobrevive ao kill --
    // e parada de emergencia que deixa processo vivo nao e parada.
    const proc = spawn('/bin/sh', ['-c', agente.comando], {
      cwd: this.#projeto,
      env,
      detached: true,
    })
    // O ciclo de vida do daemon nao pode ficar preso ao dos agentes: sem
    // `unref`, um agente rodando impede o processo pai de encerrar.
    proc.unref()

    const chave = ++this.#proximo
    const registro = {
      chave,
      agente: id,
      comando: agente.comando,
      env,
      inicio: new Date().toISOString(),
      pid: proc.pid,
    }
    this.#processos.set(chave, { proc, registro })

    const limiteMs = (agente.limits?.max_minutes ?? 45) * 60000
    const prazo = setTimeout(() => matarGrupo(proc), limiteMs)

    proc.on('close', (code) => {
      clearTimeout(prazo)
      this.#processos.delete(chave)
      this.#historico.push({ ...registro, fim: new Date().toISOString(), exit: code })
    })

    return { ok: true, processo: registro }
  }

  ativos() {
    return [...this.#processos.values()].map((p) => p.registro)
  }

  historico() {
    return this.#historico
  }

  registrarGasto(usd) {
    this.#gasto += usd
  }

  gasto() {
    return this.#gasto
  }

  /** Parada de emergencia: precisa funcionar mesmo com a UI travada. */
  async pararTudo() {
    const quantos = this.#processos.size
    for (const { proc } of this.#processos.values()) matarGrupo(proc)
    const ate = Date.now() + 3000
    while (this.#processos.size > 0 && Date.now() < ate) {
      await new Promise((r) => setTimeout(r, 20))
    }
    this.#processos.clear()
    return quantos
  }
}
