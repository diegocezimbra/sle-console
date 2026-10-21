/**
 * O que o git sabe sobre a arvore -- lido por comando, nunca por biblioteca.
 *
 * Todo comando falha para dentro: diretorio que nao e repositorio devolve
 * estado nulo, e nao excecao. Um painel de observacao nao pode cair porque a
 * pasta observada ainda nao tem `.git`.
 */
import { isAbsolute, normalize } from 'node:path'

import { runCommandSync } from './run-command.js'

const git = (dir, args) => {
  const result = runCommandSync('git', args, { cwd: dir })
  return result.ok ? result.stdout : null
}

const TIPOS = { M: 'modificado', A: 'novo', D: 'apagado', R: 'renomeado', C: 'copiado', '?': 'novo' }

export function estadoDoGit(dir) {
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? null
  if (!branch) return { branch: null, head: null, sujo: false, alteracoes: [], adiante: 0, atras: 0 }

  const alteracoes = (git(dir, ['status', '--porcelain']) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((linha) => ({
      tipo: TIPOS[linha.trim()[0]] ?? 'alterado',
      arquivo: linha.slice(3).trim(),
      staged: linha[0] !== ' ' && linha[0] !== '?',
    }))

  const contagem = git(dir, ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`])
  const [adiante = 0, atras = 0] = (contagem ?? '').trim().split(/\s+/).map(Number)

  return {
    branch,
    head: git(dir, ['rev-parse', '--short', 'HEAD'])?.trim() ?? null,
    sujo: alteracoes.length > 0,
    alteracoes,
    adiante: adiante || 0,
    atras: atras || 0,
  }
}

export function diffDoArquivo(dir, arquivo) {
  // Caminho vindo da URL nunca entra num comando sem ser contido primeiro.
  if (isAbsolute(arquivo) || normalize(arquivo).startsWith('..')) return ''
  return git(dir, ['diff', '--', arquivo]) ?? ''
}

export function historico(dir, limite = 20) {
  const saida = git(dir, ['log', `-${limite}`, '--pretty=format:%h\x1f%an\x1f%ad\x1f%s', '--date=iso'])
  if (!saida) return []
  return saida
    .split('\n')
    .filter(Boolean)
    .map((linha) => {
      const [sha, autor, data, assunto] = linha.split('\x1f')
      return { sha, autor, data, assunto }
    })
}

/** PRs abertos, quando o `gh` existe e esta autenticado. Silencioso quando nao. */
export function prsAbertos(dir) {
  const result = runCommandSync(
    'gh',
    ['pr', 'list', '--json', 'number,title,author,statusCheckRollup,isDraft,updatedAt', '--limit', '20'],
    { cwd: dir }
  )
  try { return result.ok ? JSON.parse(result.stdout) : [] } catch { return [] }
}
