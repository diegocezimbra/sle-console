import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCard, summarizeIndex, searchCards, projectLabel } from '../src/summary.js'

const full = (over = {}) => ({
  id: 'CARD-223',
  title: 'Billing: cliente do Radar',
  prioridade: 'P0',
  coluna: 'doing',
  risk: 'medio',
  owner: 'sonnet',
  prazo: 6,
  modelo: 'opus',
  project: 'diegocezimbra/01-app-billing',
  rotuloProjeto: '00-deus',
  modificado: '2026-09-29T12:00:00.000Z',
  updated: '2026-09-29T12:00:00Z',
  arquivo: '/data/00-deus/cards/doing/CARD-223.md',
  caminhoProjeto: '/data/00-deus',
  chave: '/data/00-deus#CARD-223',
  credenciais: [],
  corpo: '## Objetivo\n\nMuito texto '.repeat(200),
  ...over,
})

test('o resumo nao carrega o corpo nem caminhos do disco (payload enxuto para o celular)', () => {
  const s = summarizeCard(full())
  assert.equal(s.id, 'CARD-223')
  assert.equal(s.prioridade, 'P0')
  assert.equal(s.coluna, 'doing')
  assert.equal(s.corpo, undefined)
  assert.equal(s.arquivo, undefined)
  assert.equal(s.caminhoProjeto, undefined)
  assert.ok(JSON.stringify(s).length < 600)
})

test('projectLabel: ultimo segmento do caminho; objeto vazio do frontmatter vira vazio', () => {
  assert.equal(projectLabel('diegocezimbra/01-app-billing'), '01-app-billing')
  assert.equal(projectLabel('00-DEUS/plataforma/sle-console'), 'sle-console')
  assert.equal(projectLabel('decisao'), 'decisao')
  assert.equal(projectLabel({}), '')
  assert.equal(projectLabel(undefined), '')
  assert.equal(projectLabel('  '), '')
})

test('project que o parser leu como objeto ({} de "project:" vazio) vira string vazia', () => {
  const s = summarizeCard(full({ project: {} }))
  assert.equal(s.project, '')
  assert.equal(s.projectLabel, '')
})

test('card em pendente-diego leva a pergunta; os demais nao', () => {
  const pend = summarizeCard(full({
    coluna: 'pendente-diego',
    title: "Responda 'sim' ou 'nao'",
    corpo: '## Notas\n\n- 2026-09-29T12:00:00Z · backlog → pendente-diego\n',
  }))
  assert.deepEqual(pend.question.options, ['sim', 'nao'])
  assert.equal(pend.question.answered, null)
  assert.equal(summarizeCard(full()).question, undefined)
})

test('summarizeIndex agrupa por coluna mantendo a ordem do indice e conta o total', () => {
  const indice = {
    board: { doing: [full({ id: 'CARD-1' }), full({ id: 'CARD-2' })], review: [full({ id: 'CARD-3', coluna: 'review' })] },
  }
  const r = summarizeIndex(indice)
  assert.deepEqual(r.board.doing.map((c) => c.id), ['CARD-1', 'CARD-2'])
  assert.equal(r.total, 3)
})

const cards = [
  full({ id: 'CARD-010', title: 'Autenticação por token opaco', prioridade: 'P1', corpo: 'texto' }),
  full({ id: 'CARD-011', title: 'Outra coisa', prioridade: 'P0', corpo: 'A migração do banco de dados falhou em produção ontem à noite' }),
  full({ id: 'CARD-012', title: 'Sem relação', prioridade: 'P3', corpo: 'nada', project: 'tzo-company/cenvia' }),
]

test('busca ignora acento e caixa, e acha por titulo', () => {
  const r = searchCards(cards, 'AUTENTICACAO')
  assert.deepEqual(r.map((c) => c.id), ['CARD-010'])
})

test('busca acha no corpo e devolve um trecho ao redor do achado', () => {
  const r = searchCards(cards, 'migracao')
  assert.deepEqual(r.map((c) => c.id), ['CARD-011'])
  assert.match(r[0].snippet, /migração do banco/)
  assert.equal(r[0].corpo, undefined)
})

test('busca por id (com ou sem o prefixo CARD-) vem primeiro', () => {
  assert.equal(searchCards(cards, 'card-012')[0].id, 'CARD-012')
  assert.equal(searchCards(cards, '011')[0].id, 'CARD-011')
})

test('varios termos: todos precisam aparecer (E), em qualquer campo', () => {
  assert.deepEqual(searchCards(cards, 'cenvia sem').map((c) => c.id), ['CARD-012'])
  assert.deepEqual(searchCards(cards, 'cenvia token'), [])
})

test('termo vazio nao devolve tudo: devolve nada (a tela mostra os recentes por outro caminho)', () => {
  assert.deepEqual(searchCards(cards, '   '), [])
})

test('mesmo peso de relevancia: prioridade mais urgente primeiro', () => {
  const dois = [full({ id: 'CARD-1', title: 'deploy a', prioridade: 'P2' }), full({ id: 'CARD-2', title: 'deploy b', prioridade: 'P-1' })]
  assert.deepEqual(searchCards(dois, 'deploy').map((c) => c.id), ['CARD-2', 'CARD-1'])
})

test('limite de resultados', () => {
  const muitos = Array.from({ length: 100 }, (_, i) => full({ id: `CARD-${i}`, title: 'repetido' }))
  assert.equal(searchCards(muitos, 'repetido', 20).length, 20)
})
