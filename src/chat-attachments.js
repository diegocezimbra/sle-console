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

/** Tipo de conteudo para servir um anexo ja gravado, pela extensao (o nome so tem as tres do `KINDS`). */
export const contentTypeOf = (name) => KINDS.find((k) => name.endsWith(`.${k.ext}`))?.type ?? 'application/octet-stream'
