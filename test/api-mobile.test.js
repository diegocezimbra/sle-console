import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

let base, fechar

const put = (projeto, coluna, id, front, corpo) => {
  mkdirSync(join(projeto, 'cards', coluna), { recursive: true })
  writeFileSync(join(projeto, 'cards', coluna, `${id}.md`), `---\nid: ${id}\nstatus: ${coluna}\n${front}\n---\n${corpo}\n`)
}

before(async () => {
  const projeto = mkdtempSync(join(tmpdir(), 'sle-mobile-'))
  put(projeto, 'pendente-diego', 'CARD-900', 'title: Backup do MySQL\nprioridade: P0\nproject: infra/backups',
    '## Notas\n\n- 2026-09-29T11:37:14Z · PERGUNTA (Diego): sem backup. Opcoes: "chave S3" = criar; "ignorar" = nada.')
  put(projeto, 'doing', 'CARD-901', 'title: Migrar autenticação\nprioridade: P1\nproject:', 'corpo com a palavra hexagonal escondida')
  put(projeto, 'review', 'CARD-902', 'title: Outro\nprioridade: P3', 'corpo')
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-mobile-bd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
})
after(async () => { await fechar?.() })

const get = async (rota, headers) => fetch(base + rota, { headers })

test('resumo do board: colunas com cards enxutos, sem corpo e sem caminho de disco', async () => {
  const r = await (await get('/api/cards?summary=1')).json()
  assert.deepEqual(r.board.doing.map((c) => c.id), ['CARD-901'])
  assert.equal(r.total, 3)
  for (const cards of Object.values(r.board)) for (const c of cards) {
    assert.equal(c.corpo, undefined)
    assert.equal(c.arquivo, undefined)
  }
})

test('resumo: o card pendente leva a pergunta com as opcoes entre aspas', async () => {
  const r = await (await get('/api/cards?summary=1')).json()
  const [pend] = r.board['pendente-diego']
  assert.equal(pend.id, 'CARD-900')
  assert.deepEqual(pend.question.options, ['chave S3', 'ignorar'])
  assert.equal(pend.projectLabel, 'backups')
  assert.equal(r.board.doing[0].question, undefined)
  assert.equal(r.board.doing[0].projectLabel, '', 'project vazio vira string vazia, nunca [object Object]')
})

test('resumo com ETag: a mesma consulta com If-None-Match devolve 304 sem corpo', async () => {
  const a = await get('/api/cards?summary=1')
  const etag = a.headers.get('etag')
  assert.ok(etag)
  await a.text()
  const b = await get('/api/cards?summary=1', { 'if-none-match': etag })
  assert.equal(b.status, 304)
  assert.equal(await b.text(), '')
})

test('o resumo e bem menor que o card inteiro', async () => {
  const cheio = await (await get('/api/cards')).text()
  const resumo = await (await get('/api/cards?summary=1')).text()
  assert.ok(resumo.length < cheio.length, `${resumo.length} >= ${cheio.length}`)
})

test('/api/cards sem summary continua devolvendo o card inteiro (o desktop depende disso)', async () => {
  const r = await (await get('/api/cards')).json()
  assert.match(r.cards.find((c) => c.id === 'CARD-901').corpo, /hexagonal/)
})

test('busca acha no corpo, ignora acento e devolve trecho', async () => {
  const r = await (await get('/api/search?q=HEXAGONAL')).json()
  assert.deepEqual(r.results.map((c) => c.id), ['CARD-901'])
  assert.match(r.results[0].snippet, /hexagonal/)
  assert.deepEqual((await (await get('/api/search?q=autenticacao')).json()).results.map((c) => c.id), ['CARD-901'])
})

test('busca sem termo devolve lista vazia', async () => {
  assert.deepEqual((await (await get('/api/search?q=')).json()).results, [])
})

test('o card completo traz a pergunta e as notas ja interpretadas (a tela do celular nao reparseia texto)', async () => {
  const c = await (await get('/api/cards/CARD-900')).json()
  assert.deepEqual(c.question.options, ['chave S3', 'ignorar'])
  assert.equal(c.question.source, 'note')
  assert.equal(c.notes.length, 1)
  assert.equal(c.notes[0].ts, '2026-09-29T11:37:14Z')
  assert.match(c.notes[0].text, /^PERGUNTA \(Diego\)/)
  assert.ok(c.opcoes.includes('Outra'), 'o campo opcoes do desktop continua')
})

test('as telas do celular (/pending, /board, /search) abrem o mesmo index.html', async () => {
  for (const rota of ['/pending', '/board', '/search', '/card/CARD-901']) {
    const r = await get(rota)
    assert.equal(r.status, 200, rota)
    assert.match(r.headers.get('content-type'), /text\/html/)
    assert.match(await r.text(), /SLE Console/)
  }
})
