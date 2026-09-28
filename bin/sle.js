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
import { writeDeployKey, ensureCloned } from '../src/gitSync.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const INSTALACAO = process.env.SLE_INSTALACAO ?? join(AQUI, '..', '..')

const modoGit = process.env.CONSOLE_MODE === 'git'

/**
 * Modo git (CARD-096): a raiz de projetos deixa de ser a máquina do DEUS e
 * vira este clone único -- é dele que vêm `cards/` e `briefs/`. A chave de
 * deploy some do disco assim que o clone existe; se a env não vier, falha
 * cedo, alto e claro, em vez de subir um console que finge observar e não
 * observa nada.
 */
function prepararModoGit() {
  const repoUrl = process.env.CONSOLE_GIT_REPO_URL ?? 'git@github.com:diegocezimbra/00-deus.git'
  const branch = process.env.CONSOLE_GIT_BRANCH ?? 'main'
  const dataDir = process.env.CONSOLE_GIT_DATA_DIR ?? '/data/00-deus'
  const keyPath = process.env.CONSOLE_GIT_KEY_PATH ?? '/data/.ssh/deploy_key'
  const intervalMs = Number(process.env.CONSOLE_GIT_PULL_MS ?? 60_000)
  const deployKey = process.env.CONSOLE_GIT_DEPLOY_KEY
  if (!deployKey) throw new Error('CONSOLE_MODE=git exige CONSOLE_GIT_DEPLOY_KEY')

  writeDeployKey(keyPath, deployKey)
  const clone = ensureCloned({ repoUrl, dataDir, keyPath, branch })
  if (!clone.ok) throw new Error(`git clone de ${repoUrl} falhou: ${clone.stderr}`)
  return { dataDir, keyPath, intervalMs }
}

const git = modoGit ? prepararModoGit() : null

const cfg = lerConfig(process.env.SLE_CONFIG ?? join(INSTALACAO, 'config.json'))
if (cfg.aviso) console.warn(`  ! ${cfg.aviso}`)

const porta = Number(process.env.SLE_PORT ?? cfg.porta)
const portaOtlp = Number(process.env.SLE_PORT_OTLP ?? cfg.portaOtlp ?? porta + 1)
// Local escuta só em loopback (regra antiga: nada de expor sem auth); a
// nuvem precisa de 0.0.0.0 pra o Traefik/Coolify alcançar -- e só chega
// nesse modo com CONSOLE_USER/CONSOLE_PASSWORD, que o auth.js já exige.
const host = process.env.SLE_HOST ?? (modoGit ? '0.0.0.0' : '127.0.0.1')
const raiz = git ? [git.dataDir] : process.env.SLE_RAIZ ? [process.env.SLE_RAIZ] : cfg.observar
const dados = process.env.SLE_DATA ?? cfg.dados ?? join(INSTALACAO, 'dados', 'console')
const tetoDiarioUsd = Number(process.env.SLE_TETO_USD ?? cfg.tetoDiarioUsd)

const { servidor, observador, runner, otlp, pararGit } = criarDaemon({
  dados,
  projeto: raiz[0],
  raiz,
  tetoDiarioUsd,
  git,
})

servidor.listen(porta, host, () => {
  console.log(`sle console  http://${host}:${porta}`)
  console.log(`  observando ${raiz.length} pasta(s):`)
  for (const r of raiz) console.log(`             ${r}`)
  console.log(`  dados      ${dados}/events.jsonl`)
  if (git) console.log(`  git        ${git.dataDir} (pull a cada ${git.intervalMs}ms)`)
  otlp.listen(portaOtlp, '127.0.0.1', () =>
    console.log(`  otlp       http://127.0.0.1:${portaOtlp}/v1/metrics`)
  )
})

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    observador.parar()
    runner.pararTudo()
    pararGit()
    otlp.close()
    servidor.closeAllConnections()
    servidor.close(() => process.exit(0))
  })
}
