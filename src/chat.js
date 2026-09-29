/**
 * Chat do Diego com o DEUS: armazenamento append-only em `chat/YYYY-MM-DD.jsonl`
 * (`{ts, de, texto, id}`), o mesmo formato que `bin/deus chat` grava no 00-DEUS.
 * Sem dependencia; o daemon decide quando commitar/empurrar.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const AUTHORS = ['diego', 'deus']
export const MAX_TEXT_LENGTH = 20_000
const ARQUIVO_DIA = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

/**
 * O console e nuvem: nada que pareca credencial entra no historico (que vai
 * para o git). Mesmas familias de chave que `bin/deus-chat` recusa.
 */
const PADROES_SEGREDO = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|senha|token|secret|api[_-]?key)\s*[=:]\s*\S{6,}/i,
]

export function looksLikeSecret(texto) {
  return PADROES_SEGREDO.some((p) => p.test(texto))
}

const dirChat = (root) => join(root, 'chat')

/** Dias com file, do mais recente para o mais antigo. */
export function listDays(root) {
  const dir = dirChat(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((f) => ARQUIVO_DIA.exec(f)?.[1])
    .filter(Boolean)
    .sort()
    .reverse()
}

/**
 * Ordem cronologica (ts, depois id) e sem id repetido: o merge por uniao do git
 * (`merge=union` em chat/*.jsonl) junta as linhas dos dois lados sem garantir a
 * ordem, e o espelho da sessao DEUS publica retardatario com o ts de quando a
 * frase foi dita. O arquivo e append-only; quem le ordena.
 */
function chronological(mensagens) {
  const vistos = new Set()
  const unicas = mensagens.filter((m) => {
    if (m.id === undefined) return true
    if (vistos.has(m.id)) return false
    vistos.add(m.id)
    return true
  })
  const chave = (m) => `${m.ts}\u0000${m.id ?? ''}`
  return unicas.sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0))
}

/**
 * Linha corrompida e ignorada (meia linha, marcador de merge `<<<<<<<`): um
 * jsonl nao pode derrubar a tela, e as linhas validas dos dois lados de um
 * conflito continuam aparecendo.
 */
export function messagesOfDay(root, dia) {
  let bruto
  try {
    bruto = readFileSync(join(dirChat(root), `${dia}.jsonl`), 'utf8')
  } catch {
    return []
  }
  const saida = []
  for (const linha of bruto.split('\n')) {
    if (!linha.trim()) continue
    try {
      const m = JSON.parse(linha)
      if (m && AUTHORS.includes(m.de) && typeof m.texto === 'string' && m.ts) saida.push(m)
    } catch {
      /* ignora */
    }
  }
  return chronological(saida)
}

/**
 * Pagina por dia: os `dias` dias mais recentes anteriores a `antes` (exclusivo;
 * sem `antes`, os mais recentes). Devolve em ordem cronologica e o cursor
 * (`proximo`) para carregar o pedaco mais antigo, ou null se acabou.
 */
export function page(root, { antes = null, dias = 2 } = {}) {
  const todos = listDays(root).filter((d) => !antes || d < antes)
  const escolhidos = todos.slice(0, dias)
  const mensagens = escolhidos.slice().reverse().flatMap((d) => messagesOfDay(root, d))
  const ultimo = escolhidos[escolhidos.length - 1]
  const restam = ultimo !== undefined && todos.length > escolhidos.length
  return { mensagens, proximo: restam ? ultimo : null }
}

export function since(root, ts) {
  const dias = listDays(root)
  const saida = []
  const corte = String(ts).slice(0, 10)
  for (const d of dias) {
    if (d < corte) break
    saida.push(...messagesOfDay(root, d).filter((m) => m.ts > ts))
  }
  return saida.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
}

/** Busca por texto (sem acento nem caixa) em todo o historico, mais recentes primeiro. */
export function search(root, termo, limite = 100) {
  const alvo = normaliza(termo)
  if (!alvo) return []
  const achadas = []
  for (const d of listDays(root)) {
    const doDia = messagesOfDay(root, d).filter((m) => normaliza(m.texto).includes(alvo))
    achadas.push(...doDia.reverse())
    if (achadas.length >= limite) break
  }
  return achadas.slice(0, limite)
}

function normaliza(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Acrescenta uma mensagem (segredo: aviso por padrao, 422 com `blockSecret`); devolve o caminho relativo
 * a `root` para o commit (`file`) e todos os que entram nele (`paths`: o jsonl e as imagens).
 *
 * `files` (CARD-094) sao imagens ja validadas por `decodeAttachments`: gravadas em
 * `chat/anexos/<dia>/<id>-<n>.<ext>`, listadas em `message.anexos` (para a tela) e citadas no texto como
 * `[anexo: <caminho>]` (para quem le so o jsonl, como `deus chat`).
 */
export function append(root, { de, texto, agora = new Date(), blockSecret = false, files = [] }) {
  if (!AUTHORS.includes(de)) return { ok: false, code: 422, error: 'autor invalido' }
  const limpo = String(texto ?? '').trim()
  if (!limpo && !files.length) return { ok: false, code: 422, error: 'texto obrigatorio' }
  if (limpo.length > MAX_TEXT_LENGTH) {
    return { ok: false, code: 422, error: `texto acima de ${MAX_TEXT_LENGTH} caracteres` }
  }
  const secret = looksLikeSecret(limpo)
  if (secret && blockSecret) {
    return { ok: false, code: 422, error: 'a mensagem parece conter token ou senha; o chat vai para o git, nao envie segredo' }
  }
  const ts = agora.toISOString()
  const id = `${ts.replace(/\D/g, '').slice(0, 17)}-${randomUUID().slice(0, 8)}`
  const relativo = join('chat', `${ts.slice(0, 10)}.jsonl`)
  const anexos = files.map((f, i) => ({ arquivo: join('chat', 'anexos', ts.slice(0, 10), `${id}-${i + 1}.${f.ext}`), tipo: f.type, bytes: f.bytes.length, ...(f.width && { largura: f.width, altura: f.height }) }))
  const citacao = anexos.map((a) => `[anexo: ${a.arquivo}]`).join('\n')
  const message = { ts, de, texto: [limpo, citacao].filter(Boolean).join('\n\n'), id, ...(anexos.length && { anexos }) }
  // Imagem antes da linha: quem ve a mensagem no jsonl nunca acha um caminho que ainda nao existe.
  files.forEach((f, i) => {
    mkdirSync(join(root, anexos[i].arquivo, '..'), { recursive: true })
    writeFileSync(join(root, anexos[i].arquivo), f.bytes)
  })
  mkdirSync(dirChat(root), { recursive: true })
  appendFileSync(join(root, relativo), JSON.stringify(message) + '\n')
  return { ok: true, message, file: relativo, paths: [relativo, ...anexos.map((a) => a.arquivo)], ...(secret && { warning: 'secret' }) }
}
