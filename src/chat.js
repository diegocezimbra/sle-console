/**
 * Chat do Diego com o DEUS: armazenamento append-only em `chat/YYYY-MM-DD.jsonl`
 * (`{ts, de, texto, id}`), o mesmo formato que `bin/deus chat` grava no 00-DEUS.
 * Sem dependencia; o daemon decide quando commitar/empurrar.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const AUTORES = ['diego', 'deus']
export const LIMITE_TEXTO_CHAT = 20_000
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

export function pareceSegredo(texto) {
  return PADROES_SEGREDO.some((p) => p.test(texto))
}

const dirChat = (raiz) => join(raiz, 'chat')

/** Dias com arquivo, do mais recente para o mais antigo. */
export function listarDias(raiz) {
  const dir = dirChat(raiz)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((f) => ARQUIVO_DIA.exec(f)?.[1])
    .filter(Boolean)
    .sort()
    .reverse()
}

/** Linha corrompida e ignorada: um jsonl com meia linha nao pode derrubar a tela. */
export function mensagensDoDia(raiz, dia) {
  let bruto
  try {
    bruto = readFileSync(join(dirChat(raiz), `${dia}.jsonl`), 'utf8')
  } catch {
    return []
  }
  const saida = []
  for (const linha of bruto.split('\n')) {
    if (!linha.trim()) continue
    try {
      const m = JSON.parse(linha)
      if (m && AUTORES.includes(m.de) && typeof m.texto === 'string' && m.ts) saida.push(m)
    } catch {
      /* ignora */
    }
  }
  return saida
}

/**
 * Pagina por dia: os `dias` dias mais recentes anteriores a `antes` (exclusivo;
 * sem `antes`, os mais recentes). Devolve em ordem cronologica e o cursor
 * (`proximo`) para carregar o pedaco mais antigo, ou null se acabou.
 */
export function pagina(raiz, { antes = null, dias = 2 } = {}) {
  const todos = listarDias(raiz).filter((d) => !antes || d < antes)
  const escolhidos = todos.slice(0, dias)
  const mensagens = escolhidos.slice().reverse().flatMap((d) => mensagensDoDia(raiz, d))
  const ultimo = escolhidos[escolhidos.length - 1]
  const restam = ultimo !== undefined && todos.length > escolhidos.length
  return { mensagens, proximo: restam ? ultimo : null }
}

export function desde(raiz, ts) {
  const dias = listarDias(raiz)
  const saida = []
  const corte = String(ts).slice(0, 10)
  for (const d of dias) {
    if (d < corte) break
    saida.push(...mensagensDoDia(raiz, d).filter((m) => m.ts > ts))
  }
  return saida.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
}

/** Busca por texto (sem acento nem caixa) em todo o historico, mais recentes primeiro. */
export function buscar(raiz, termo, limite = 100) {
  const alvo = normaliza(termo)
  if (!alvo) return []
  const achadas = []
  for (const d of listarDias(raiz)) {
    const doDia = mensagensDoDia(raiz, d).filter((m) => normaliza(m.texto).includes(alvo))
    achadas.push(...doDia.reverse())
    if (achadas.length >= limite) break
  }
  return achadas.slice(0, limite)
}

function normaliza(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Acrescenta uma mensagem; devolve o caminho relativo a `raiz` para o commit. */
export function acrescentar(raiz, { de, texto, agora = new Date() }) {
  if (!AUTORES.includes(de)) return { ok: false, codigo: 422, erro: 'autor invalido' }
  const limpo = String(texto ?? '').trim()
  if (!limpo) return { ok: false, codigo: 422, erro: 'texto obrigatorio' }
  if (limpo.length > LIMITE_TEXTO_CHAT) {
    return { ok: false, codigo: 422, erro: `texto acima de ${LIMITE_TEXTO_CHAT} caracteres` }
  }
  if (pareceSegredo(limpo)) {
    return { ok: false, codigo: 422, erro: 'a mensagem parece conter token ou senha; o chat vai para o git, nao envie segredo' }
  }
  const ts = agora.toISOString()
  const mensagem = { ts, de, texto: limpo, id: `${ts.replace(/\D/g, '').slice(0, 17)}-${randomUUID().slice(0, 8)}` }
  const relativo = join('chat', `${ts.slice(0, 10)}.jsonl`)
  mkdirSync(dirChat(raiz), { recursive: true })
  appendFileSync(join(raiz, relativo), JSON.stringify(mensagem) + '\n')
  return { ok: true, mensagem, arquivo: relativo }
}
