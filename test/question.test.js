import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractQuestion, parseNotes } from '../src/question.js'

// Cartas reais do 00-DEUS (29/09) reduzidas ao que interessa: a pergunta vive numa NOTA
// ("PERGUNTA (Diego): ... Opcoes: \"a\" = ...") ou no proprio TITULO ("Responda 'x' ou 'y'").
const corpo = (notas, extra = '') => `## Objetivo\n\n_a refinar_\n\n## Notas\n\n${notas.map((n) => `- ${n}`).join('\n')}\n${extra}`

test('parseNotes le "- <ts> · <texto>" em ordem de arquivo e ignora o que nao e nota', () => {
  const notes = parseNotes(corpo([
    '2026-09-29T11:35:54Z · criado',
    'linha sem carimbo nao e nota',
    '2026-09-29T11:37:12Z · backlog → pendente-diego',
  ]))
  assert.deepEqual(notes, [
    { ts: '2026-09-29T11:35:54Z', text: 'criado' },
    { ts: '2026-09-29T11:37:12Z', text: 'backlog → pendente-diego' },
  ])
})

test('parseNotes sem secao Notas devolve lista vazia', () => {
  assert.deepEqual(parseNotes('## Objetivo\n\nx\n'), [])
  assert.deepEqual(parseNotes(undefined), [])
})

test('opcoes entre aspas duplas depois de "Opcoes:" viram botoes, na ordem em que aparecem', () => {
  const q = extractQuestion({
    title: 'INFRA sem backup',
    corpo: corpo([
      '2026-09-29T11:37:14Z · PERGUNTA (Diego): o MySQL nao tem backup. Opcoes: "chave S3" = criar chave; "mover pra prod" = migrar; "ignorar" = sem backup.',
    ]),
  })
  assert.deepEqual(q.options, ['chave S3', 'mover pra prod', 'ignorar'])
  assert.equal(q.source, 'note')
  assert.match(q.text, /^PERGUNTA \(Diego\): o MySQL nao tem backup/)
  assert.doesNotMatch(q.text, /^2026/, 'o carimbo nao faz parte da pergunta')
})

test('a nota MAIS RECENTE com opcoes vence a antiga (atualizacao de opcoes)', () => {
  const q = extractQuestion({
    title: 'Billing',
    corpo: corpo([
      '2026-09-29T11:51:37Z · ATUALIZACAO 09:15: Opcoes agora: "hotfix" | "past_due" | "deixa e estorna".',
      '2026-09-29T12:57:29Z · ATUALIZACAO 09:58: Opcoes atualizadas: "aplica a regra" = cancelar | "estorna os 300" = tirar | "deixa" = aceita.',
      '2026-09-29T14:38:24Z · Diego 29/09: a regra correta e valor cheio (sem opcoes aqui).',
    ]),
  })
  assert.deepEqual(q.options, ['aplica a regra', 'estorna os 300', 'deixa'])
})

test('sem aspas depois de um marcador, nada vira botao (rotulo de tela entre aspas nao e opcao)', () => {
  const q = extractQuestion({
    title: "PENDENTE Qualificou: o app esta em 'Testing'. Voce precisa: 'Publicar app' no console. Responda 'publicado' quando fizer.",
    corpo: corpo(['2026-09-29T12:53:17Z · backlog → pendente-diego']),
  })
  assert.deepEqual(q.options, ['publicado'])
  assert.equal(q.source, 'title')
})

test('titulo com varias opcoes entre aspas simples separadas por "ou"', () => {
  const q = extractQuestion({
    title: "PENDENTE Billing: Responda: 'corta no deploy' (sobe como esta) ou 'avisa antes' (segura) ou 'perdoa <ids>' (apaga a fatura) ou 'outra'",
    corpo: corpo(['2026-09-29T13:21:38Z · backlog → pendente-diego']),
  })
  assert.deepEqual(q.options, ['corta no deploy', 'avisa antes', 'perdoa <ids>', 'outra'])
})

test('apostrofo dentro de palavra (d\'agua) nao fabrica opcao', () => {
  const q = extractQuestion({
    title: "Responda 'sim' ou 'nao'. A caixa d'agua e o copo d'agua nao contam.",
    corpo: corpo(['2026-09-29T13:21:38Z · criado']),
  })
  assert.deepEqual(q.options, ['sim', 'nao'])
})

test('aspas curvas tambem valem', () => {
  const q = extractQuestion({ title: 'Escolha “agora” ou “depois”', corpo: corpo(['2026-09-29T13:21:38Z · criado']) })
  assert.deepEqual(q.options, ['agora', 'depois'])
})

test('sem opcoes em lugar nenhum: so texto livre, e a pergunta e a nota PERGUNTA', () => {
  const q = extractQuestion({
    title: 'PENDENTE Cenvia: decidir correcao dos dados',
    corpo: corpo(['2026-09-29T13:58:05Z · PERGUNTA (Diego): corrijo os 15 fluxos ou desligo?']),
  })
  assert.deepEqual(q.options, [])
  assert.equal(q.source, 'note')
  assert.match(q.text, /corrijo os 15 fluxos/)
})

test('sem opcoes e sem nota de pergunta: pergunta nula (a tela mostra o titulo)', () => {
  const q = extractQuestion({ title: 'PENDENTE decidir correcao', corpo: corpo(['2026-09-29T13:58:05Z · criado']) })
  assert.deepEqual(q, { text: null, options: [], source: null, answered: null })
})

test('secao "## Opcoes" com "- A: texto" (formato antigo) vira "A) texto"', () => {
  const q = extractQuestion({
    title: 'Decidir',
    corpo: '## O que decidir\n\nUsar A ou B?\n\n## Opções\n\n- A: usar token opaco\n- B: manter JWT\n',
  })
  assert.deepEqual(q.options, ['A) usar token opaco', 'B) manter JWT'])
  assert.equal(q.source, 'section')
  assert.match(q.text, /Usar A ou B\?/)
})

test('limite: no maximo 8 opcoes e nenhuma com mais de 80 caracteres', () => {
  const muitas = Array.from({ length: 12 }, (_, i) => `"op${i}"`).join(' | ')
  const q = extractQuestion({
    title: 't',
    corpo: corpo([`2026-09-29T13:58:05Z · Opcoes: ${muitas} | "${'x'.repeat(90)}"`]),
  })
  assert.equal(q.options.length, 8)
  assert.ok(q.options.every((o) => o.length <= 80))
})

test('repetida com caixa diferente conta uma vez', () => {
  const q = extractQuestion({ title: "Responda 'Sim' ou 'sim' ou 'nao'", corpo: corpo(['2026-09-29T13:21:38Z · criado']) })
  assert.deepEqual(q.options, ['Sim', 'nao'])
})

const resposta = (quando, opcao, texto = '') => `\n## Resposta do Diego (${quando})\n**Opção:** ${opcao}\n${texto}\n`

test('respondida: resposta POSTERIOR a pergunta aparece com a opcao e o momento', () => {
  const q = extractQuestion({
    title: 't',
    corpo: corpo(['2026-09-29T12:00:00Z · Opcoes: "a" | "b"'], resposta('2026-09-29 12:30', 'a')),
  })
  assert.deepEqual(q.answered, { option: 'a', text: '', at: '2026-09-29T12:30:00Z' })
})

test('respondida: pergunta NOVA (opcoes atualizadas) depois da resposta volta a esperar o Diego', () => {
  const q = extractQuestion({
    title: 't',
    corpo: corpo(['2026-09-29T12:00:00Z · Opcoes: "a" | "b"', '2026-09-29T13:00:00Z · Opcoes atualizadas: "c" | "d"'], resposta('2026-09-29 12:30', 'a')),
  })
  assert.equal(q.answered, null)
  assert.deepEqual(q.options, ['c', 'd'])
})

test('respondida: nota de "recebi" sem opcoes DEPOIS da resposta nao desfaz o respondido', () => {
  const q = extractQuestion({
    title: 't',
    corpo: corpo(['2026-09-29T12:00:00Z · Opcoes: "a" | "b"', '2026-09-29T12:31:00Z · resposta recebida, aplicando'], resposta('2026-09-29 12:30', 'a', 'com texto')),
  })
  assert.equal(q.answered.option, 'a')
  assert.equal(q.answered.text, 'com texto')
})

test('respondida: pergunta so no titulo -- vale a resposta depois da entrada em pendente-diego', () => {
  const antes = extractQuestion({
    title: "Responda 'sim' ou 'nao'",
    corpo: corpo(['2026-09-29T12:00:00Z · backlog → pendente-diego'], resposta('2026-09-29 11:00', 'nao')),
  })
  assert.equal(antes.answered, null, 'resposta de antes de virar pendente nao vale')
  const depois = extractQuestion({
    title: "Responda 'sim' ou 'nao'",
    corpo: corpo(['2026-09-29T12:00:00Z · backlog → pendente-diego'], resposta('2026-09-29 12:10', 'sim')),
  })
  assert.equal(depois.answered.option, 'sim')
})
