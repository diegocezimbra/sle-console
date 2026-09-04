#!/usr/bin/env node
/**
 * `sle` — sobe o daemon de observação e controle.
 *
 * A configuração vem de `config.json` na raiz da instalação (ou de
 * `SLE_CONFIG`). Variável de ambiente ainda vence, para uso pontual.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { criarDaemon } from '../src/daemon.js'
import { lerConfig } from '../src/config.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const INSTALACAO = process.env.SLE_INSTALACAO ?? join(AQUI, '..', '..')

const cfg = lerConfig(process.env.SLE_CONFIG ?? join(INSTALACAO, 'config.json'))
if (cfg.aviso) console.warn(`  ! ${cfg.aviso}`)

const porta = Number(process.env.SLE_PORT ?? cfg.porta)
const portaOtlp = Number(process.env.SLE_PORT_OTLP ?? cfg.portaOtlp ?? porta + 1)
const raiz = process.env.SLE_RAIZ ? [process.env.SLE_RAIZ] : cfg.observar
const dados = process.env.SLE_DATA ?? cfg.dados ?? join(INSTALACAO, 'dados', 'console')
const tetoDiarioUsd = Number(process.env.SLE_TETO_USD ?? cfg.tetoDiarioUsd)

const { servidor, observador, runner, otlp } = criarDaemon({
  dados,
  projeto: raiz[0],
  raiz,
  tetoDiarioUsd,
})

servidor.listen(porta, '127.0.0.1', () => {
  console.log(`sle console  http://127.0.0.1:${porta}`)
  console.log(`  observando ${raiz.length} pasta(s):`)
  for (const r of raiz) console.log(`             ${r}`)
  console.log(`  dados      ${dados}/events.jsonl`)
  otlp.listen(portaOtlp, '127.0.0.1', () =>
    console.log(`  otlp       http://127.0.0.1:${portaOtlp}/v1/metrics`)
  )
})

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    observador.parar()
    runner.pararTudo()
    otlp.close()
    servidor.closeAllConnections()
    servidor.close(() => process.exit(0))
  })
}
