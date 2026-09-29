/**
 * Imagens anexadas ao chat (CARD-094): o Diego tira uma foto ou escolhe da galeria e ela vai junto
 * com a mensagem. Aqui so a validacao e a decodificacao: quem grava e o `append` de chat.js, e quem
 * empurra para o git e o chat-routes.js.
 *
 * O tipo vem dos BYTES, nunca do que o cliente declarou: um `.svg` com script ou um shell script
 * chamado `foto.jpg` nao passa.
 */
export const MAX_ATTACHMENTS = 4
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024
/** 4 fotos de ate 6 MB em base64 nao cabem; o cliente reduz para ~1600 px (uns 300 KB), entao 8 MB sobra. */
export const ATTACHMENT_BODY_LIMIT = 8 * 1024 * 1024

const KINDS = [
  { type: 'image/jpeg', ext: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', ext: 'webp', matches: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
]

const refuse = (code, error) => ({ ok: false, code, error })

/** Largura e altura vindas do cliente so servem para a tela reservar o espaco (sem salto de layout); lixo vira nada. */
function dimensions(item) {
  const ok = (n) => Number.isInteger(n) && n > 0 && n <= 20_000
  return ok(item?.largura) && ok(item?.altura) ? { width: item.largura, height: item.altura } : {}
}

/** `[{dados: <base64>}]` -> `{ok, files: [{type, ext, bytes}]}`; ou `{ok: false, code, error}`. */
export function decodeAttachments(list) {
  if (!Array.isArray(list) || list.length === 0) return refuse(422, 'anexos: lista vazia ou invalida')
  if (list.length > MAX_ATTACHMENTS) return refuse(422, `no maximo ${MAX_ATTACHMENTS} imagens por mensagem`)
  const files = []
  for (const item of list) {
    const bytes = Buffer.from(String(item?.dados ?? ''), 'base64')
    if (bytes.length === 0) return refuse(422, 'anexo vazio')
    if (bytes.length > MAX_ATTACHMENT_BYTES) return refuse(413, 'imagem grande demais')
    const kind = KINDS.find((k) => k.matches(bytes))
    if (!kind) return refuse(422, 'so imagem jpeg, png ou webp')
    files.push({ type: kind.type, ext: kind.ext, bytes, ...dimensions(item) })
  }
  return { ok: true, files }
}

/**
 * O que o console SERVE de `chat/anexos/` (CARD-240): as imagens do Diego e o que o DEUS manda com `deus chat enviar --arquivo`.
 * Imagem sai inline; o resto e download. Nada de html/svg: o que o navegador poderia executar nunca entra na lista.
 */
const SERVED = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  pdf: 'application/pdf', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8',
}
export const SERVED_EXTENSIONS = Object.keys(SERVED)
const extensionOf = (name) => String(name).slice(String(name).lastIndexOf('.') + 1).toLowerCase()

/** Tipo de conteudo para servir um anexo ja gravado, pela extensao. */
export const contentTypeOf = (name) => SERVED[extensionOf(name)] ?? 'application/octet-stream'

/** So imagem abre dentro da pagina; qualquer outro tipo e baixado. */
export const isInlineImage = (name) => contentTypeOf(name).startsWith('image/')

/** Nome para o download: so o ultimo trecho, sem aspas, ponto e virgula, barra nem caractere de controle. */
export function downloadName(wanted, fallback) {
  const base = String(wanted ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f";]/g, '').replace(/\.{2,}/g, '.').trim().slice(0, 120)
  return base && base !== '.' ? base : fallback
}

/** `Content-Disposition` com o nome em ASCII (clientes antigos) e em UTF-8 (RFC 5987). */
export function dispositionOf(name, wanted) {
  const nome = downloadName(wanted, name)
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/\\/g, '_')
  const utf8 = encodeURIComponent(nome).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${isInlineImage(name) ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
