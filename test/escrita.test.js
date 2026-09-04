import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { salvarArquivo, validar } from '../src/escrita.js'

function projeto() {
  const d = mkdtempSync(join(tmpdir(), 'sle-esc-'))
  for (const p of ['cards/doing', 'sle/gates', 'sle/prompts', 'sle/agents', 'docs/adr']) {
    mkdirSync(join(d, p), { recursive: true })
  }
  mkdirSync(join(d, '.git'), { recursive: true })
  writeFileSync(join(d, '.git', 'config'), 'segredo')
  return d
}

test('salva dentro das pastas permitidas', () => {
  const d = projeto()
  const r = salvarArquivo(d, 'cards/doing/CARD-1.md', '---\nid: CARD-1\n---\nok\n')
  assert.equal(r.ok, true)
  assert.match(readFileSync(join(d, 'cards/doing/CARD-1.md'), 'utf8'), /id: CARD-1/)
})

test('recusa travessia de caminho', () => {
  const d = projeto()
  const r = salvarArquivo(d, '../fora.md', 'x')
  assert.equal(r.ok, false)
  assert.match(r.erro, /fora do projeto/i)
  assert.equal(existsSync(join(d, '..', 'fora.md')), false)
})

test('recusa caminho absoluto', () => {
  assert.equal(salvarArquivo(projeto(), '/etc/passwd', 'x').ok, false)
})

test('recusa escrever dentro de .git', () => {
  const d = projeto()
  const r = salvarArquivo(d, '.git/config', 'invadido')
  assert.equal(r.ok, false)
  assert.equal(readFileSync(join(d, '.git/config'), 'utf8'), 'segredo')
})

test('recusa pasta que nao esta na allowlist', () => {
  const d = projeto()
  const r = salvarArquivo(d, 'node_modules/x.js', 'x')
  assert.equal(r.ok, false)
  assert.match(r.erro, /pasta/i)
})

test('symlink apontando para fora nao vira porta de saida', () => {
  const d = projeto()
  const alvo = mkdtempSync(join(tmpdir(), 'sle-alvo-'))
  symlinkSync(alvo, join(d, 'cards', 'escapatoria'))
  const r = salvarArquivo(d, 'cards/escapatoria/x.md', 'x')
  assert.equal(r.ok, false)
  assert.equal(existsSync(join(alvo, 'x.md')), false)
})

test('JSON invalido e recusado antes de tocar no disco', () => {
  const d = projeto()
  const r = salvarArquivo(d, 'sle/gates/pipeline.json', '{ isto nao e json')
  assert.equal(r.ok, false)
  assert.match(r.erro, /json/i)
  assert.equal(existsSync(join(d, 'sle/gates/pipeline.json')), false)
})

test('gate sem os campos obrigatorios nao entra', () => {
  const r = validar('sle/gates/pipeline.json', JSON.stringify({ gates: [{ nome: 'sem id' }] }))
  assert.equal(r.ok, false)
  assert.match(r.erro, /id/)
})

test('gate valido passa', () => {
  const bom = { stages: [], gates: [{ id: 'G1', name: 'Requisitos', after: 'E1', mode: 'human' }] }
  assert.equal(validar('sle/gates/pipeline.json', JSON.stringify(bom)).ok, true)
})

test('modo de gate desconhecido e recusado: gate que nao roda e pior que nenhum', () => {
  const mau = { gates: [{ id: 'G1', name: 'X', after: 'E1', mode: 'talvez' }] }
  const r = validar('sle/gates/pipeline.json', JSON.stringify(mau))
  assert.equal(r.ok, false)
  assert.match(r.erro, /talvez/)
})

test('agente que aprova o proprio gate e recusado: quem escreve nao aprova', () => {
  const agente = { id: 'implementer', role: 'maker', stages: ['E4'], can_approve_gates: ['G3'] }
  const r = validar('sle/agents/implementer.json', JSON.stringify(agente))
  assert.equal(r.ok, false)
  assert.match(r.erro, /aprova/i)
})

test('maker sem poder de aprovacao passa', () => {
  const agente = { id: 'implementer', role: 'maker', stages: ['E4'], can_approve_gates: [] }
  assert.equal(validar('sle/agents/implementer.json', JSON.stringify(agente)).ok, true)
})

test('card sem frontmatter e recusado', () => {
  const r = validar('cards/doing/CARD-1.md', '# sem frontmatter')
  assert.equal(r.ok, false)
})

test('prompt e markdown livre: nao ha o que validar', () => {
  assert.equal(validar('sle/prompts/implement.md', 'qualquer texto').ok, true)
})
