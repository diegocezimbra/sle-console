import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  redigirCenso,
  lerCenso,
  escreverEstadoPublico,
  lerEstadoPublico,
  publicarCenso,
} from '../src/estadoPublico.js'

const dir = () => mkdtempSync(join(tmpdir(), 'sle-publico-'))

test('redigirCenso mantem so os campos seguros e extrai o card do texto', () => {
  const censo = {
    'sessao-a [111111]': {
      projeto: '01-ohanax/13-chatomnichannel',
      escopo: 'Cenvia / CARD-118 corte semanal',
      tarefa: 'ociosa',
      modelo: 'claude-opus-5',
      atualizado: '2026-09-28T10:00:00Z',
      pid: '12345',
      from: 'uds:/run/user/1000/cc-socks/12345.sock',
      bloqueios: 'token do Coolify vazou parcialmente',
      arquivos: '3 meus',
      pendente_push: 'nenhum',
    },
  }
  const [r] = redigirCenso(censo)
  assert.equal(r.sessao, 'sessao-a [111111]')
  assert.equal(r.card, 'CARD-118')
  assert.equal(r.modelo, 'claude-opus-5')
  assert.equal(r.projeto, '01-ohanax/13-chatomnichannel')
  assert.equal(r.pid, undefined)
  assert.equal(r.from, undefined)
  assert.equal(r.bloqueios, undefined)
  assert.equal(r.arquivos, undefined)
  assert.equal(r.pendente_push, undefined)
})

test('redigirCenso extrai o card da tarefa quando o escopo nao tem um', () => {
  const censo = { s: { escopo: 'sem card', tarefa: 'retomando CARD-042 agora' } }
  const [r] = redigirCenso(censo)
  assert.equal(r.card, 'CARD-042')
})

test('redigirCenso: sem CARD em escopo/tarefa, card e null', () => {
  const censo = { s: { escopo: 'trabalho livre', tarefa: 'ociosa' } }
  const [r] = redigirCenso(censo)
  assert.equal(r.card, null)
})

test('censo vazio ou ausente vira lista vazia, nunca erro', () => {
  assert.deepEqual(redigirCenso(null), [])
  assert.deepEqual(redigirCenso(undefined), [])
  assert.deepEqual(redigirCenso({}), [])
})

test('lerCenso tolera arquivo inexistente ou corrompido', () => {
  assert.deepEqual(lerCenso(join(dir(), 'nao-existe.json')), {})
  const d = dir()
  const f = join(d, 'corrompido.json')
  writeFileSync(f, '{ nao é json')
  assert.deepEqual(lerCenso(f), {})
})

test('escreverEstadoPublico grava atomico e lerEstadoPublico devolve o mesmo conteudo', () => {
  const d = dir()
  const f = join(d, 'sub', 'sessoes.json')
  const sessoes = [{ sessao: 's [111111]', card: 'CARD-120', modelo: 'claude-sonnet-5' }]
  escreverEstadoPublico(f, sessoes)
  const lido = JSON.parse(readFileSync(f, 'utf8'))
  assert.ok(lido.atualizado)
  assert.deepEqual(lido.sessoes, sessoes)

  const relido = lerEstadoPublico(f)
  assert.deepEqual(relido.sessoes, sessoes)
  assert.equal(relido.atualizado, lido.atualizado)
})

test('lerEstadoPublico tolera arquivo ausente ou corrompido, nunca lanca', () => {
  const d = dir()
  assert.deepEqual(lerEstadoPublico(join(d, 'nada.json')), { atualizado: null, sessoes: [] })
  const f = join(d, 'ruim.json')
  writeFileSync(f, 'nao é json')
  assert.deepEqual(lerEstadoPublico(f), { atualizado: null, sessoes: [] })
})

test('publicarCenso encadeia leitura, redacao e escrita', () => {
  const d = dir()
  const censoPath = join(d, 'estado', 'sessoes.json')
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  mkdirSync(dirname(censoPath), { recursive: true })
  writeFileSync(censoPath, JSON.stringify({ 's [aaaaaaaa]': { escopo: 'CARD-007', modelo: 'claude-sonnet-5' } }))

  const { sessoes, mudou } = publicarCenso({ censoPath, publicoPath })
  assert.equal(mudou, true)
  assert.equal(sessoes.length, 1)
  assert.equal(sessoes[0].card, 'CARD-007')

  const relido = lerEstadoPublico(publicoPath)
  assert.equal(relido.sessoes[0].modelo, 'claude-sonnet-5')
})

test('publicarCenso com o mesmo censo nao reescreve o arquivo (revisao do PR #4)', () => {
  const d = dir()
  const censoPath = join(d, 'estado', 'sessoes.json')
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  mkdirSync(dirname(censoPath), { recursive: true })
  writeFileSync(censoPath, JSON.stringify({ 's [aaaaaaaa]': { escopo: 'CARD-007', modelo: 'claude-sonnet-5' } }))

  const primeira = publicarCenso({ censoPath, publicoPath })
  assert.equal(primeira.mudou, true)
  const carimboAntes = lerEstadoPublico(publicoPath).atualizado

  // Censo idêntico, chamado de novo -- como o publish-loop de 30 em 30s faria
  // com a máquina parada. Sem essa checagem, o carimbo de tempo sozinho
  // pareceria mudança e o daemon commitaria/empurraria pra sempre.
  const segunda = publicarCenso({ censoPath, publicoPath })
  assert.equal(segunda.mudou, false)
  assert.equal(lerEstadoPublico(publicoPath).atualizado, carimboAntes, 'sem mudanca real, o arquivo nao e regravado')

  // Censo muda de verdade -- agora sim precisa escrever.
  writeFileSync(censoPath, JSON.stringify({ 's [aaaaaaaa]': { escopo: 'CARD-008', modelo: 'claude-sonnet-5' } }))
  const terceira = publicarCenso({ censoPath, publicoPath })
  assert.equal(terceira.mudou, true)
  assert.equal(lerEstadoPublico(publicoPath).sessoes[0].card, 'CARD-008')
})
