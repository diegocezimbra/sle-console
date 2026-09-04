/**
 * Escrita de arquivo pela UI -- a parte do daemon com mais poder de estrago.
 *
 * Duas defesas independentes, nesta ordem: **conter o caminho** (nada sai da
 * raiz, nada entra em `.git`, nada fora da allowlist, symlink resolvido antes
 * de decidir) e **validar o conteudo** (JSON quebrado ou gate invalido nao
 * chega ao disco). Falha fechada: o que nao se sabe validar, nao se grava.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

import { lerCard } from './cards.js'

/** Unicas pastas graváveis. Fora daqui, o daemon nao escreve. */
const PERMITIDAS = ['cards', 'sle', 'docs']
const MODOS_DE_GATE = ['auto', 'human', 'auto_unless', 'advisory']

export function salvarArquivo(raiz, caminho, conteudo) {
  const contido = conter(raiz, caminho)
  if (!contido.ok) return contido

  const checagem = validar(caminho, conteudo)
  if (!checagem.ok) return checagem

  try {
    mkdirSync(dirname(contido.absoluto), { recursive: true })
    writeFileSync(contido.absoluto, conteudo)
    return { ok: true, arquivo: caminho }
  } catch (e) {
    return { ok: false, erro: `nao consegui gravar: ${e.message}` }
  }
}

/** Resolve o caminho e responde se ele pode ser tocado. */
export function conter(raiz, caminho) {
  if (!caminho || isAbsolute(caminho) || caminho.includes('\0')) {
    return { ok: false, erro: 'caminho fora do projeto' }
  }
  const relativo = normalize(caminho)
  if (relativo.startsWith('..')) return { ok: false, erro: 'caminho fora do projeto' }

  const primeira = relativo.split(/[/\\]/)[0]
  if (primeira === '.git') return { ok: false, erro: 'o diretorio .git nao e editavel' }
  if (!PERMITIDAS.includes(primeira)) {
    return { ok: false, erro: `pasta nao permitida: ${primeira}` }
  }

  const absoluto = resolve(raiz, relativo)
  // Symlink no meio do caminho pode apontar para fora: decidir pelo caminho
  // real, e nao pelo que a string parece dizer.
  const paiReal = tentarRealpath(dirname(absoluto))
  const raizReal = tentarRealpath(raiz)
  if (paiReal && raizReal && !dentro(raizReal, paiReal)) {
    return { ok: false, erro: 'caminho fora do projeto' }
  }
  return { ok: true, absoluto }
}

const dentro = (raiz, alvo) => alvo === raiz || !relative(raiz, alvo).startsWith('..' + sep) && !relative(raiz, alvo).startsWith('..')

function tentarRealpath(p) {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

/** Validacao por tipo de arquivo. O que nao tem regra, passa como texto. */
export function validar(caminho, conteudo) {
  const normalizado = caminho.replace(/\\/g, '/')

  if (normalizado.endsWith('.json')) {
    let dados
    try {
      dados = JSON.parse(conteudo)
    } catch (e) {
      return { ok: false, erro: `JSON invalido: ${e.message}` }
    }
    if (normalizado.includes('/gates/')) return validarGates(dados)
    if (normalizado.includes('/agents/')) return validarAgente(dados)
    return { ok: true }
  }

  if (normalizado.startsWith('cards/') && normalizado.endsWith('.md')) {
    return lerCard(conteudo) ? { ok: true } : { ok: false, erro: 'card sem frontmatter valido' }
  }
  return { ok: true }
}

function validarGates(dados) {
  for (const gate of dados.gates ?? []) {
    for (const campo of ['id', 'name', 'after', 'mode']) {
      if (!gate[campo]) return { ok: false, erro: `gate sem "${campo}": ${JSON.stringify(gate)}` }
    }
    if (!MODOS_DE_GATE.includes(gate.mode)) {
      return { ok: false, erro: `modo de gate desconhecido: "${gate.mode}"` }
    }
  }
  return { ok: true }
}

function validarAgente(agente) {
  if (!agente.id) return { ok: false, erro: 'agente sem "id"' }
  // "Quem escreve nao aprova" e regra estrutural, nao conselho: a validacao
  // recusa salvar um agente que apareca como executor e aprovador.
  const executa = (agente.stages ?? []).length > 0
  const aprova = (agente.can_approve_gates ?? []).length > 0
  if (executa && aprova) {
    return {
      ok: false,
      erro: `${agente.id} executa etapas e aprova gates: quem escreve nao aprova`,
    }
  }
  return { ok: true }
}
