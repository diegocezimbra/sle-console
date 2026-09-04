import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lerCard, indexarCards } from '../src/cards.js'

const CARD = `---
id: CARD-042
title: Migrar autenticação de sessão para token opaco
status: doing
risk: alto
budget_turns: 25
budget_usd: 8
agent_bindings:
  E1: refiner
  E4: implementer
gate_overrides:
  G3: humano
session_ids: [abc123, def456]
---

## Requisitos

R1. O sistema DEVE invalidar o refresh anterior.
`

test('o frontmatter vira dados e o corpo fica intacto', () => {
  const c = lerCard(CARD)
  assert.equal(c.id, 'CARD-042')
  assert.equal(c.title, 'Migrar autenticação de sessão para token opaco')
  assert.equal(c.status, 'doing')
  assert.equal(c.risk, 'alto')
  assert.match(c.corpo, /^## Requisitos/m)
  assert.doesNotMatch(c.corpo, /^id:/m, 'o frontmatter nao pode vazar para o corpo')
})

test('numero vira numero, para orcamento poder ser comparado', () => {
  const c = lerCard(CARD)
  assert.equal(c.budget_turns, 25)
  assert.equal(c.budget_usd, 8)
  assert.equal(typeof c.budget_turns, 'number')
})

test('bloco aninhado vira objeto: e o que liga etapa a agente', () => {
  const c = lerCard(CARD)
  assert.deepEqual(c.agent_bindings, { E1: 'refiner', E4: 'implementer' })
  assert.deepEqual(c.gate_overrides, { G3: 'humano' })
})

test('lista em linha vira array', () => {
  assert.deepEqual(lerCard(CARD).session_ids, ['abc123', 'def456'])
})

test('arquivo sem frontmatter nao vira card silenciosamente', () => {
  assert.equal(lerCard('# so um markdown\n'), null)
})

test('frontmatter aberto e nao fechado tambem e recusado', () => {
  assert.equal(lerCard('---\nid: X\n\nsem fechar\n'), null)
})

function arvore() {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-cards-'))
  for (const col of ['backlog', 'doing', 'done']) mkdirSync(join(raiz, 'cards', col), { recursive: true })
  writeFileSync(join(raiz, 'cards', 'doing', 'CARD-042.md'), CARD)
  writeFileSync(join(raiz, 'cards', 'backlog', 'CARD-001.md'),
    '---\nid: CARD-001\ntitle: Outro\nstatus: backlog\nrisk: baixo\n---\ncorpo\n')
  writeFileSync(join(raiz, 'cards', 'done', 'LEIAME.txt'), 'nao e card')
  return raiz
}

test('o indice acha os cards e sabe de que coluna cada um veio', () => {
  const i = indexarCards(arvore())
  assert.equal(i.cards.length, 2)
  const c42 = i.cards.find((c) => c.id === 'CARD-042')
  assert.equal(c42.coluna, 'doing')
  assert.ok(c42.arquivo.endsWith('cards/doing/CARD-042.md'))
})

test('o board agrupa por coluna, na ordem do pipeline', () => {
  const i = indexarCards(arvore())
  assert.deepEqual(Object.keys(i.board), [
    'backlog', 'refinamento', 'aprovado', 'doing', 'review', 'done', 'recurring',
  ])
  assert.equal(i.board.doing.length, 1)
  assert.equal(i.board.backlog[0].id, 'CARD-001')
})

test('status que discorda da pasta e reportado, nao escondido', () => {
  const raiz = arvore()
  writeFileSync(join(raiz, 'cards', 'done', 'CARD-009.md'),
    '---\nid: CARD-009\ntitle: Divergente\nstatus: doing\n---\nx\n')
  const i = indexarCards(raiz)
  const div = i.divergencias.find((d) => d.id === 'CARD-009')
  assert.ok(div, 'a pasta e a verdade, mas a divergencia precisa aparecer')
  assert.equal(div.coluna, 'done')
  assert.equal(div.status, 'doing')
})

test('arvore sem pasta de cards devolve indice vazio em vez de estourar', () => {
  const i = indexarCards(mkdtempSync(join(tmpdir(), 'sle-vazio-')))
  assert.deepEqual(i.cards, [])
})
