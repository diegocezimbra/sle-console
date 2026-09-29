import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { append } from '../src/chat.js'
import { decodeAttachments, MAX_ATTACHMENTS } from '../src/chat-attachments.js'
import { makePng } from './apoio/png.js'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const b64 = (buf) => buf.toString('base64')
const raiz = () => mkdtempSync(join(tmpdir(), 'sle-anx-'))

test('decodeAttachments aceita jpeg, png e webp pelos bytes (o tipo declarado nao manda)', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
  const r = decodeAttachments([{ tipo: 'image/png', dados: b64(JPEG) }, { dados: b64(makePng()) }, { dados: b64(webp) }])
  assert.equal(r.ok, true)
  assert.deepEqual(r.files.map((f) => [f.type, f.ext]), [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])
})

test('decodeAttachments recusa o que nao e imagem, vazio, lista grande e arquivo enorme', () => {
  assert.equal(decodeAttachments([{ dados: b64(Buffer.from('#!/bin/sh\nrm -rf /')) }]).ok, false)
  assert.equal(decodeAttachments([{ dados: b64(Buffer.from('<svg onload=alert(1)>')) }]).ok, false)
  assert.equal(decodeAttachments([{ dados: '' }]).ok, false)
  assert.equal(decodeAttachments([]).ok, false)
  assert.equal(decodeAttachments('nao e lista').ok, false)
  const muitas = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({ dados: b64(JPEG) }))
  assert.equal(decodeAttachments(muitas).ok, false)
  const enorme = Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)])
  const r = decodeAttachments([{ dados: b64(enorme) }])
  assert.equal(r.ok, false)
  assert.equal(r.code, 413)
})

test('append com imagem grava o arquivo, o anexo na mensagem e a linha [anexo: ...] no texto (para quem le so o jsonl)', () => {
  const r = raiz()
  const { files } = decodeAttachments([{ dados: b64(makePng()) }, { dados: b64(JPEG) }])
  const a = append(r, { de: 'diego', texto: 'olha isso', agora: new Date('2026-09-29T10:00:00Z'), files })
  assert.equal(a.ok, true)
  assert.equal(a.message.anexos.length, 2)
  const [um, dois] = a.message.anexos
  assert.match(um.arquivo, /^chat\/anexos\/2026-09-29\/[\w-]+-1\.png$/)
  assert.match(dois.arquivo, /-2\.jpg$/)
  assert.equal(um.tipo, 'image/png')
  assert.ok(um.bytes > 0)
  assert.ok(existsSync(join(r, um.arquivo)) && existsSync(join(r, dois.arquivo)))
  assert.deepEqual(readFileSync(join(r, um.arquivo)), makePng())
  assert.match(a.message.texto, /^olha isso\n\n\[anexo: chat\/anexos\/2026-09-29\/[\w-]+-1\.png\]\n\[anexo: chat\/anexos\/2026-09-29\/[\w-]+-2\.jpg\]$/)
  assert.deepEqual(a.paths, ['chat/2026-09-29.jsonl', um.arquivo, dois.arquivo])
})

test('largura e altura validas do cliente ficam no anexo; lixo e ignorado', () => {
  const r = raiz()
  const { files } = decodeAttachments([{ dados: b64(makePng()), largura: 800, altura: 600 }, { dados: b64(JPEG), largura: -1, altura: 'x' }])
  const a = append(r, { de: 'diego', texto: 'x', files })
  assert.deepEqual([a.message.anexos[0].largura, a.message.anexos[0].altura], [800, 600])
  assert.equal(a.message.anexos[1].largura, undefined)
})

test('so imagem, sem texto, tambem e mensagem valida', () => {
  const r = raiz()
  const { files } = decodeAttachments([{ dados: b64(JPEG) }])
  const a = append(r, { de: 'diego', texto: '', files })
  assert.equal(a.ok, true)
  assert.match(a.message.texto, /^\[anexo: chat\/anexos\//)
})

test('sem texto e sem imagem continua recusado; o limite de 20 mil caracteres vale so para o texto digitado', () => {
  const r = raiz()
  assert.equal(append(r, { de: 'diego', texto: '  ' }).ok, false)
  const { files } = decodeAttachments([{ dados: b64(JPEG) }])
  assert.equal(append(r, { de: 'diego', texto: 'x'.repeat(20_001), files }).ok, false)
})
