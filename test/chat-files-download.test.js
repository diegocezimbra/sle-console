// CARD-240 (entrega 2): o DEUS manda arquivo pelo chat (`deus chat enviar --arquivo`). A imagem aparece inline; pdf, texto, csv e json
// sao DOWNLOAD com nome. Sem token na URL: a autenticacao e a do console (Basic), a mesma de toda rota.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { makePng } from './apoio/png.js'

const DIA = '2026-09-29'
const png = makePng(8, 8, [1, 2, 3])
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n')
const md = Buffer.from('# nota\ntexto\n')

async function subir(env = {}) {
  const dados = mkdtempSync(join(tmpdir(), 'sle-dl-d-'))
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  const d = criarDaemon({ dados })
  for (const k of Object.keys(env)) delete process.env[k]
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  return {
    base: `http://127.0.0.1:${d.servidor.address().port}`,
    fechar: () => new Promise((r) => { d.observador.parar(); d.pararGit(); d.servidor.closeAllConnections(); d.servidor.close(r) }),
  }
}

let dir
let s
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sle-dl-dir-'))
  mkdirSync(join(dir, 'chat', 'anexos', DIA), { recursive: true })
  for (const [nome, bytes] of [['a1-1.png', png], ['a2-1.pdf', pdf], ['a3-1.md', md], ['a4-1.csv', Buffer.from('a,b\n1,2\n')], ['a5-1.json', Buffer.from('{"ok":true}')], ['a6-1.txt', Buffer.from('oi')], ['a7-1.html', Buffer.from('<script>1</script>')]]) {
    writeFileSync(join(dir, 'chat', 'anexos', DIA, nome), bytes)
  }
  process.env.CONSOLE_CHAT_DIR = dir
  s = await subir()
})
after(async () => {
  delete process.env.CONSOLE_CHAT_DIR
  await s?.fechar()
})

const get = (caminho) => fetch(`${s.base}/api/chat/anexos/${DIA}/${caminho}`)

test('imagem sai inline, com o tipo certo', async () => {
  const r = await get('a1-1.png')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.match(r.headers.get('content-disposition'), /^inline/)
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), png)
})

test('pdf sai como download com o nome que veio na URL e sem sniffing', async () => {
  const r = await get('a2-1.pdf?nome=relat%C3%B3rio%20final.pdf')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/pdf')
  const cd = r.headers.get('content-disposition')
  assert.match(cd, /^attachment/)
  assert.match(cd, /filename\*=UTF-8''relat%C3%B3rio%20final\.pdf/)
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), pdf)
})

test('md, csv, json e txt sao download (nunca renderizados pelo navegador)', async () => {
  for (const [nome, tipo] of [['a3-1.md', 'text/markdown'], ['a4-1.csv', 'text/csv'], ['a5-1.json', 'application/json'], ['a6-1.txt', 'text/plain']]) {
    const r = await get(nome)
    assert.equal(r.status, 200, nome)
    assert.ok(r.headers.get('content-type').startsWith(tipo), `${nome}: ${r.headers.get('content-type')}`)
    assert.match(r.headers.get('content-disposition'), /^attachment/, nome)
  }
})

test('sem ?nome= o download usa o nome do arquivo no disco', async () => {
  const r = await get('a2-1.pdf')
  assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''a2-1\.pdf/)
})

test('nome com barra, aspas ou quebra de linha nao injeta cabecalho nem escapa da pasta', async () => {
  const r = await get('a2-1.pdf?nome=' + encodeURIComponent('../../etc/x";\r\nSet-Cookie: a=b'))
  assert.equal(r.status, 200)
  const cd = r.headers.get('content-disposition')
  assert.doesNotMatch(cd, /[\r\n"]\s*Set-Cookie/i)
  assert.equal(r.headers.get('set-cookie'), null)
  assert.doesNotMatch(cd, /\.\.|\/etc/)
})

test('extensao fora da lista (html) e arquivo inexistente dao 404', async () => {
  assert.equal((await get('a7-1.html')).status, 404)
  assert.equal((await get('nao-existe-1.pdf')).status, 404)
})

test('download exige a autenticacao do console: 401 sem credencial, 200 com Basic (sem token na URL)', async () => {
  const seguro = await subir({ CONSOLE_USER: 'diego', CONSOLE_PASSWORD: 'senha-de-teste' })
  try {
    const url = `${seguro.base}/api/chat/anexos/${DIA}/a2-1.pdf`
    assert.equal((await fetch(url)).status, 401)
    const basic = `Basic ${Buffer.from('diego:senha-de-teste').toString('base64')}`
    assert.equal((await fetch(url, { headers: { authorization: basic } })).status, 200)
  } finally {
    await seguro.fechar()
  }
})
