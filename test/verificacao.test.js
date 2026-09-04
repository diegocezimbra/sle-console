import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testarComando } from '../src/verificacao.js'

const proj = () => mkdtempSync(join(tmpdir(), 'sle-ver-'))

test('comando que passa devolve saida e codigo zero', async () => {
  const r = await testarComando(proj(), 'echo tudo certo')
  assert.equal(r.exit, 0)
  assert.match(r.saida, /tudo certo/)
  assert.equal(typeof r.ms, 'number')
})

test('comando que falha devolve o codigo e o erro, nao uma excecao', async () => {
  const r = await testarComando(proj(), 'echo falhou 1>&2; exit 3')
  assert.equal(r.exit, 3)
  assert.match(r.saida, /falhou/, 'stderr faz parte da saida: e onde o motivo aparece')
})

test('roda dentro do projeto, e nao no diretorio do daemon', async () => {
  const d = proj()
  const r = await testarComando(d, 'pwd')
  assert.match(r.saida.trim(), new RegExp(d.split('/').pop()))
})

test('comando que trava e cortado pelo limite, com o motivo explicito', async () => {
  const r = await testarComando(proj(), 'sleep 30', { limite: 400 })
  assert.equal(r.expirou, true)
  assert.match(r.saida, /limite/i)
  assert.notEqual(r.exit, 0)
})

test('saida gigante e truncada: um gate nao pode encher a memoria do daemon', async () => {
  const r = await testarComando(proj(), 'head -c 400000 /dev/zero | tr "\\0" "x"', { maximo: 2000 })
  assert.ok(r.saida.length <= 2200, `saida veio com ${r.saida.length} caracteres`)
  assert.match(r.saida, /truncad/i)
})

test('comando vazio nao roda', async () => {
  const r = await testarComando(proj(), '   ')
  assert.equal(r.ok, false)
})
