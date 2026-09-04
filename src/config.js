/**
 * A configuração da instalação: o que observar, em que porta, com que teto.
 *
 * Um arquivo, na raiz da instalação, editável à mão. Config quebrada avisa e
 * cai no padrão -- um erro de vírgula não pode deixar você sem painel.
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const PADRAO = {
  porta: 7717,
  portaOtlp: null, // padrão: porta + 1
  observar: null, // padrão: o diretório atual
  dados: null, // padrão: <instalação>/dados
  tetoDiarioUsd: null,
  ttlSessaoMin: 15,
}

export function lerConfig(arquivo) {
  let bruto = {}
  let aviso = null
  try {
    bruto = JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') aviso = `config ignorada (${e.message}) — usando o padrão`
  }

  const observar = bruto.observar ?? PADRAO.observar
  const lista = observar == null ? [process.cwd()] : Array.isArray(observar) ? observar : [observar]

  return {
    ...PADRAO,
    ...bruto,
    observar: lista.map(expandir),
    dados: bruto.dados ? expandir(bruto.dados) : null,
    tetoDiarioUsd: bruto.tetoDiarioUsd ?? Infinity,
    aviso,
  }
}

/** `~/x` é o que a pessoa digita; o resto do sistema precisa do caminho real. */
function expandir(caminho) {
  const texto = String(caminho)
  if (texto.startsWith('~')) return join(process.env.HOME ?? '', texto.slice(1))
  return isAbsolute(texto) ? texto : resolve(texto)
}
