import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estadoDoGit, diffDoArquivo, historico } from '../src/repo.js'

function repoGit() {
  const d = mkdtempSync(join(tmpdir(), 'sle-git-'))
  const git = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'Teste')
  writeFileSync(join(d, 'a.txt'), 'um\n')
  git('add', 'a.txt')
  git('commit', '-qm', 'primeiro commit')
  return { d, git }
}

test('o estado do git diz o basico sem precisar de rede', () => {
  const { d } = repoGit()
  const e = estadoDoGit(d)
  assert.equal(e.branch, 'main')
  assert.equal(e.sujo, false)
  assert.equal(e.alteracoes.length, 0)
  assert.match(e.head, /^[0-9a-f]{7,}$/)
})

test('arquivo modificado aparece como alteracao, com o tipo certo', () => {
  const { d } = repoGit()
  writeFileSync(join(d, 'a.txt'), 'dois\n')
  writeFileSync(join(d, 'novo.txt'), 'x\n')
  const e = estadoDoGit(d)
  assert.equal(e.sujo, true)
  const porArquivo = Object.fromEntries(e.alteracoes.map((a) => [a.arquivo, a.tipo]))
  assert.equal(porArquivo['a.txt'], 'modificado')
  assert.equal(porArquivo['novo.txt'], 'novo')
})

test('o diff volta como texto do arquivo pedido', () => {
  const { d } = repoGit()
  writeFileSync(join(d, 'a.txt'), 'dois\n')
  const diff = diffDoArquivo(d, 'a.txt')
  assert.match(diff, /^-um$/m)
  assert.match(diff, /^\+dois$/m)
})

test('caminho fora do repositorio nao e aceito no diff', () => {
  const { d } = repoGit()
  assert.equal(diffDoArquivo(d, '../../etc/passwd'), '')
})

test('o historico traz os commits recentes com autor e assunto', () => {
  const { d } = repoGit()
  const h = historico(d, 5)
  assert.equal(h.length, 1)
  assert.equal(h[0].assunto, 'primeiro commit')
  assert.equal(h[0].autor, 'Teste')
})

test('diretorio que nao e repositorio devolve estado nulo, nao excecao', () => {
  const e = estadoDoGit(mkdtempSync(join(tmpdir(), 'sle-nao-git-')))
  assert.equal(e.branch, null)
  assert.equal(e.alteracoes.length, 0)
})
