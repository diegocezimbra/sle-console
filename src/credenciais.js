/**
 * Cofre de credenciais de TESTE (CARD-202): o console recebe o valor UMA vez, criptografa com a chave PÚBLICA age
 * do DEUS (env `DEUS_AGE_RECIPIENT`) e grava só o `.age` no volume privado. Não existe caminho de leitura:
 * a API devolve nome + status, nunca valor. Quem decripta é o DEUS (`deus cred sync`), que depois apaga o `.age`.
 *
 * Criptografa chamando o binário `age` (o mesmo que o DEUS usa para decriptar) em vez de reimplementar o formato:
 * criptografia caseira é o tipo de código que ninguém audita. O valor vai pelo stdin, nunca por argumento.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const RE_CHAVE = /^[A-Z][A-Z0-9_]{2,63}$/
const LIMITE_VALOR = 64 * 1024
const RE_LINHA = /^\s*[-*]\s+`?([A-Z][A-Z0-9_]{2,63})`?\s*(?:[—–-]+\s*status:\s*(\w+))?/

/** Chaves listadas na seção `## Credenciais necessárias` do card, com o status que o card declara. */
export function chavesDoCard(corpo) {
  const linhas = String(corpo ?? '').split('\n')
  const inicio = linhas.findIndex((l) => /^##\s+Credenciais necess[aá]rias\s*$/i.test(l))
  if (inicio === -1) return []
  const chaves = []
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^##\s/.test(linha)) break
    const m = RE_LINHA.exec(linha)
    if (m) chaves.push({ name: m[1], declared: m[2] === 'preenchida' ? 'preenchida' : 'ausente' })
  }
  return chaves
}

/** Status por chave: `enviada` (o `.age` espera o DEUS puxar) > `preenchida` (o DEUS já guardou) > `ausente`. */
export function statusDasChaves({ chaves, dirAge, raizPublica }) {
  const enviadas = new Set(listarPendentes(dirAge))
  const publicado = lerStatusPublicado(raizPublica)
  return chaves.map(({ name, declared }) => ({
    name,
    status: enviadas.has(name) ? 'enviada' : (publicado[name] ?? declared),
  }))
}

function listarPendentes(dirAge) {
  try {
    return readdirSync(dirAge).filter((n) => n.endsWith('.age')).map((n) => n.slice(0, -4))
  } catch {
    return []
  }
}

function lerStatusPublicado(raizPublica) {
  try {
    return JSON.parse(readFileSync(join(raizPublica, 'estado-publico', 'credenciais.json'), 'utf8'))
  } catch {
    return {}
  }
}

/** O destinatário vem SÓ do ambiente do container (`DEUS_AGE_RECIPIENT`, definido no Coolify): quem escreve no repo
 *  git não pode trocar a chave para a qual as credenciais são criptografadas. Inválido ou ausente = null (503). */
export function destinatarioDoAmbiente(env = process.env) {
  const r = String(env.DEUS_AGE_RECIPIENT ?? '').trim()
  return /^age1[0-9a-z]{50,}$/.test(r) ? r : null
}

/** Criptografa `valor` para `destinatario` e grava `<dirAge>/<nome>.age` (0600, atômico). Nunca devolve o valor. */
export function salvarCredencial({ dirAge, destinatario, nome, valor, ageBin = 'age' }) {
  if (!RE_CHAVE.test(nome ?? '')) return { ok: false, codigo: 422, erro: 'nome de chave inválido' }
  if (typeof valor !== 'string' || valor.length === 0) return { ok: false, codigo: 422, erro: 'valor obrigatório' }
  if (Buffer.byteLength(valor, 'utf8') > LIMITE_VALOR) return { ok: false, codigo: 422, erro: 'valor acima de 64 KB' }
  if (!destinatario) return { ok: false, codigo: 503, erro: 'chave pública do DEUS indisponível (DEUS_AGE_RECIPIENT ausente no container)' }

  const r = spawnSync(ageBin, ['-r', destinatario], { input: valor, maxBuffer: 4 * LIMITE_VALOR })
  if (r.status !== 0 || !r.stdout?.length) return { ok: false, codigo: 500, erro: 'falha ao criptografar' }

  mkdirSync(dirAge, { recursive: true, mode: 0o700 })
  const destino = join(dirAge, `${nome}.age`)
  const tmp = `${destino}.tmp`
  writeFileSync(tmp, r.stdout, { mode: 0o600 })
  renameSync(tmp, destino)
  return { ok: true, name: nome, status: 'enviada' }
}

