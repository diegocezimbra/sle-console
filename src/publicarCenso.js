/**
 * Pedido de publicação do censo (CARD-226/288).
 *
 * O censo local (`estado-publico/sessoes.json`) nasce neste daemon, mas quem o leva ao GitHub deixou de ser ele. A primeira versão
 * (CARD-120) commitava e enviava o arquivo pela `main` do checkout do 00-DEUS a cada 2-3 min -- e, com o envio rejeitado, puxava com
 * rebase. Esse checkout é compartilhado e vive sujo: a árvore ficava suja, a `main` divergia (15 commits à frente) e o pull com rebase
 * recusado parou a publicação de cards em 29/09 e 03/10.
 *
 * Agora o daemon só GRAVA o arquivo e PEDE a publicação a `bin/deus publicar-censo`, que usa o MESMO caminho dos cards: clone privado,
 * merge de 3 vias por arquivo, envio simples e, depois, `fetch` + `merge --ff-only` no checkout só se ele estiver limpo. O comando
 * volta na hora (a publicação roda em segundo plano, com lock e marcador durável); falha dela vira log + marcador no 00-DEUS, não erro aqui.
 *
 * Nenhum git neste módulo, de propósito: há um teste que garante.
 */
import { join } from 'node:path'

import { runPeriodicCommand } from './run-command.js'

const TIMEOUT_PADRAO_MS = 15_000
const LIMITE_ERRO = 500

/**
 * `deusHome` é o repositório dono do censo (o checkout do 00-DEUS): é dele o `bin/deus` e é nele que o daemon gravou o arquivo.
 * `env` entra por cima do ambiente do processo (marcador/remoto de teste); o `PATH` do daemon segue valendo (git, jq, flock).
 * Devolve `solicitarPublicacao()`, que NUNCA rejeita: `{ ok: true }` ou `{ ok: false, status?, erro }`.
 */
export function criarSolicitadorPublicacao({
  deusHome,
  comando = join(deusHome, 'bin', 'deus'),
  env = {},
  timeoutMs = TIMEOUT_PADRAO_MS,
  executar = runPeriodicCommand,
}) {
  return function solicitarPublicacao() {
    return executar(comando, ['publicar-censo'], {
      env: { ...process.env, DEUS_HOME: deusHome, ...env },
      timeoutMs,
    }).then((result) => {
      if (result.ok) return { ok: true }
      const status = typeof result.code === 'number' ? result.code : null
      const detalhe = result.timedOut
        ? `tempo esgotado (${timeoutMs}ms)`
        : String(result.stderr || result.error || result.signal || 'falha ao executar').trim()
      return { ok: false, status, erro: detalhe.slice(0, LIMITE_ERRO) }
    }).catch((erro) => ({ ok: false, erro: String(erro?.message ?? erro).slice(0, LIMITE_ERRO) }))
  }
}
