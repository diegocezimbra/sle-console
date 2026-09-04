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

const { servidor } = criarDaemon({ dados })

servidor.listen(porta, '127.0.0.1', () => {
  console.log(`sle console  http://127.0.0.1:${porta}`)
  console.log(`  dados      ${dados}/events.jsonl`)
  console.log(`  hook       curl -s -X POST http://127.0.0.1:${porta}/api/hook --data-binary @-`)
})

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.closeAllConnections()
    servidor.close(() => process.exit(0))
  })
}
