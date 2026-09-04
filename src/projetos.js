/**
 * Descoberta de projetos numa arvore que tem varios.
 *
 * Um repositorio git e um projeto -- e a mesma fronteira que o resto do sistema
 * usa, porque o indice do git e o recurso disputado.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const IGNORAR = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', 'vendor'])

/**
 * Repositorios git ate `profundidade` niveis abaixo de cada raiz.
 * Aceita uma raiz ou varias -- clientes costumam morar em pastas diferentes.
 */
export function descobrirProjetos(raizes, profundidade = 3) {
  const lista = Array.isArray(raizes) ? raizes : [raizes]
  const achados = []
  const vistos = new Set()
  for (const raiz of lista) {
    const desta = []
    varrer(raiz, raiz, profundidade, desta)
    for (const p of desta) {
      if (vistos.has(p.caminho)) continue
      vistos.add(p.caminho)
      achados.push(p)
    }
  }
  return achados.sort((a, b) => a.rotulo.localeCompare(b.rotulo))
}

function varrer(raiz, dir, resta, achados) {
  if (resta < 0) return
  let entradas
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  // Um projeto e uma pasta com repositorio git OU com a estrutura do SLE:
  // a pasta que guarda os cards conta, mesmo sem git.
  const marcas = new Set(entradas.filter((e) => e.isDirectory()).map((e) => e.name))
  if (marcas.has('.git') || marcas.has('cards') || marcas.has('sle')) {
    const rel = relative(raiz, dir)
    achados.push({
      nome: dir.split(sep).pop(),
      // O rotulo carrega o pai: dois "api" de clientes diferentes precisam se
      // distinguir no seletor.
      rotulo: rel.split(sep).slice(-2).join('/') || dir.split(sep).pop(),
      caminho: dir,
    })
    // E segue descendo: uma pasta guarda-chuva pode ser um repo e ainda ter
    // dezenas de repos dentro. Parar aqui esconderia todos eles.
  }

  for (const e of entradas) {
    if (!e.isDirectory() || IGNORAR.has(e.name) || e.name.startsWith('.')) continue
    varrer(raiz, join(dir, e.name), resta - 1, achados)
  }
}

/**
 * O projeto pedido, se ele estiver na arvore. Caminho vindo da URL nunca vira
 * leitura de pasta arbitraria.
 */
export function resolverProjeto(raizes, pedido) {
  const projetos = descobrirProjetos(raizes)
  if (pedido) {
    const alvo = resolve(pedido)
    const valido = projetos.find((p) => resolve(p.caminho) === alvo)
    if (valido) return valido.caminho
  }
  const primeira = Array.isArray(raizes) ? raizes[0] : raizes
  return projetos[0]?.caminho ?? primeira
}

/** O diretorio existe e e uma pasta? */
export function ehPasta(caminho) {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}
