#!/usr/bin/env node
/**
 * `sle` — sobe o daemon de observacao na 7717, so em loopback.
 *
 * Fase 1: observar. A escrita e o controle sao fases seguintes, e ate la o
 * daemon nao tem um unico endpoint que mude o seu repositorio.
 */
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

const porta = Number(process.env.SLE_PORT ?? 7717)
const dados = process.env.SLE_DATA ?? join(process.cwd(), 'sle', 'runtime')

const projeto = process.env.SLE_PROJETO ?? process.cwd()
const tetoDiarioUsd = Number(process.env.SLE_TETO_USD ?? Infinity)
const { servidor, observador, runner, otlp } = criarDaemon({ dados, projeto, tetoDiarioUsd })
const portaOtlp = Number(process.env.SLE_PORT_OTLP ?? porta + 1)

servidor.listen(porta, '127.0.0.1', () => {
  console.log(`sle console  http://127.0.0.1:${porta}`)
  console.log(`  projeto    ${projeto}`)
  console.log(`  dados      ${dados}/events.jsonl`)
  otlp.listen(portaOtlp, '127.0.0.1', () =>
    console.log(`  otlp       http://127.0.0.1:${portaOtlp}/v1/metrics (OTEL_EXPORTER_OTLP_PROTOCOL=http/json)`)
  )
  console.log(`  hook       curl -s -X POST http://127.0.0.1:${porta}/api/hook --data-binary @-`)
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
