import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acrescentar, buscar, desde, listarDias, mensagensDoDia, pagina, pareceSegredo } from '../src/chat.js'
import { renderMarkdown } from '../web/chat-md.js'

const raiz = () => mkdtempSync(join(tmpdir(), 'sle-chat-'))
const em = (r, dia, msgs) => {
  mkdirSync(join(r, 'chat'), { recursive: true })
  writeFileSync(join(r, 'chat', `${dia}.jsonl`), msgs.map((m) => JSON.stringify(m)).join('\n') + '\n')
}
const m = (ts, de, texto) => ({ ts, de, texto, id: `id-${ts}` })

test('acrescentar grava jsonl append-only no arquivo do dia com ts, de, texto e id', () => {
  const r = raiz()
  const a = acrescentar(r, { de: 'diego', texto: ' oi ', agora: new Date('2026-09-29T10:00:00Z') })
  const b = acrescentar(r, { de: 'deus', texto: 'olá', agora: new Date('2026-09-29T10:00:05Z') })
  assert.equal(a.arquivo, 'chat/2026-09-29.jsonl')
  const linhas = readFileSync(join(r, a.arquivo), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(linhas.length, 2)
  assert.deepEqual(Object.keys(linhas[0]).sort(), ['de', 'id', 'texto', 'ts'])
  assert.equal(linhas[0].texto, 'oi')
  assert.notEqual(a.mensagem.id, b.mensagem.id)
})

test('acrescentar recusa vazio, autor invalido, texto enorme e segredo', () => {
  const r = raiz()
  assert.equal(acrescentar(r, { de: 'diego', texto: '   ' }).ok, false)
  assert.equal(acrescentar(r, { de: 'outro', texto: 'x' }).ok, false)
  assert.equal(acrescentar(r, { de: 'diego', texto: 'x'.repeat(20_001) }).ok, false)
  const s = acrescentar(r, { de: 'diego', texto: 'meu token ghp_' + 'a'.repeat(30) })
  assert.equal(s.ok, false)
  assert.match(s.erro, /token ou senha/)
  assert.deepEqual(listarDias(r), [])
})

test('pareceSegredo pega as familias conhecidas e deixa texto normal passar', () => {
  for (const t of ['ghp_' + 'A'.repeat(36), 'sk_live_' + 'a'.repeat(20), '123456789:' + 'A'.repeat(35), 'senha=abc12345',
    'AKIA' + 'A'.repeat(16), '-----BEGIN RSA PRIVATE KEY-----', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdefghijkl']) {
    assert.equal(pareceSegredo(t), true, t)
  }
  for (const t of ['bom dia', 'o token expira em 7 dias', 'CARD-208 pronto', 'https://x.com/a?b=c']) {
    assert.equal(pareceSegredo(t), false, t)
  }
})

test('pagina devolve os dias mais recentes em ordem cronologica e o cursor dos antigos', () => {
  const r = raiz()
  em(r, '2026-09-27', [m('2026-09-27T10:00:00Z', 'diego', 'a')])
  em(r, '2026-09-28', [m('2026-09-28T10:00:00Z', 'deus', 'b')])
  em(r, '2026-09-29', [m('2026-09-29T09:00:00Z', 'diego', 'c'), m('2026-09-29T09:01:00Z', 'deus', 'd')])
  const p1 = pagina(r, { dias: 2 })
  assert.deepEqual(p1.mensagens.map((x) => x.texto), ['b', 'c', 'd'])
  assert.equal(p1.proximo, '2026-09-28')
  const p2 = pagina(r, { antes: p1.proximo, dias: 2 })
  assert.deepEqual(p2.mensagens.map((x) => x.texto), ['a'])
  assert.equal(p2.proximo, null)
})

test('linha corrompida no jsonl e ignorada', () => {
  const r = raiz()
  mkdirSync(join(r, 'chat'))
  writeFileSync(join(r, 'chat', '2026-09-29.jsonl'),
    JSON.stringify(m('2026-09-29T10:00:00Z', 'diego', 'ok')) + '\n{meia linha\n{"de":"x"}\n')
  assert.equal(mensagensDoDia(r, '2026-09-29').length, 1)
})

test('buscar ignora acento e caixa, mais recentes primeiro', () => {
  const r = raiz()
  em(r, '2026-09-28', [m('2026-09-28T10:00:00Z', 'diego', 'Aprovação do PR')])
  em(r, '2026-09-29', [m('2026-09-29T10:00:00Z', 'deus', 'aprovacao feita'), m('2026-09-29T11:00:00Z', 'deus', 'outra coisa')])
  assert.deepEqual(buscar(r, 'APROVACAO').map((x) => x.texto), ['aprovacao feita', 'Aprovação do PR'])
  assert.deepEqual(buscar(r, ''), [])
})

test('desde devolve so o que veio depois do carimbo', () => {
  const r = raiz()
  em(r, '2026-09-29', [m('2026-09-29T10:00:00Z', 'diego', 'velha'), m('2026-09-29T10:05:00Z', 'deus', 'nova')])
  assert.deepEqual(desde(r, '2026-09-29T10:00:00Z').map((x) => x.texto), ['nova'])
})

test('markdown: negrito, lista, link, bloco de codigo e nada de HTML cru', () => {
  assert.match(renderMarkdown('**forte** e `cod`'), /<strong>forte<\/strong> e <code>cod<\/code>/)
  assert.match(renderMarkdown('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/)
  assert.match(renderMarkdown('1. a\n2. b'), /<ol>/)
  assert.match(renderMarkdown('veja https://x.com/a'), /<a href="https:\/\/x.com\/a" target="_blank" rel="noopener noreferrer">/)
  assert.match(renderMarkdown('```\nx < y\n```'), /<pre><code>x &lt; y<\/code><\/pre>/)
  const perigo = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1))')
  assert.doesNotMatch(perigo, /<script/)
  assert.doesNotMatch(perigo, /href="javascript/)
  assert.doesNotMatch(renderMarkdown('`**nao**`'), /<strong>/)
})
