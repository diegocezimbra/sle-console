// Anexos do chat (CARD-094): foto pela camera ou imagem da galeria. A imagem e reduzida NO
// APARELHO (no maximo 1600 px no lado maior, JPEG) antes de subir: foto de celular tem 3 a 8 MB e o
// chat vai para o git; reduzida ela pesa uns 300 KB e o DEUS le do mesmo jeito.
const MAX_FILES = 4
const MAX_SIDE = 1600
const KEEP_AS_IS_BYTES = 700 * 1024
const QUALITY = 0.82
const KEEPABLE = /^image\/(jpeg|png|webp)$/

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' }) // respeita a rotacao da camera
    } catch { /* formato que o createImageBitmap nao le: tenta pelo <img> */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem ilegivel')) }
    img.src = url
  })
}

/** `{blob, width, height}`. Imagem pequena e leve segue como veio (screenshot com texto nao ganha artefato de JPEG). */
export async function shrinkImage(file) {
  const source = await decode(file)
  const width = source.width ?? source.naturalWidth
  const height = source.height ?? source.naturalHeight
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  if (scale === 1 && file.size <= KEEP_AS_IS_BYTES && KEEPABLE.test(file.type)) {
    source.close?.()
    return { blob: file, width, height }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // PNG transparente vira fundo branco no JPEG (senao sairia preto)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  source.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('nao consegui reduzir a imagem')
  return { blob, width: canvas.width, height: canvas.height }
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1])
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}
const PAPERCLIP = '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8.3-8.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'

/**
 * Liga o botao de anexo, o menu (Tirar foto / Escolher da galeria) e a faixa de miniaturas.
 * `button` e `menu` ja estao no HTML; `preview` e a lista onde as miniaturas aparecem.
 */
export function mountAttachments({ button, menu, preview, notify }) {
  const items = []
  const inputs = {
    camera: el('input', { type: 'file', accept: 'image/*', hidden: true }),
    gallery: el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true }),
  }
  inputs.camera.setAttribute('capture', 'environment')
  document.body.append(inputs.camera, inputs.gallery)
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="24" height="24">${PAPERCLIP}</svg>`

  const closeMenu = () => {
    menu.hidden = true
    button.setAttribute('aria-expanded', 'false')
  }
  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden
    button.setAttribute('aria-expanded', String(!menu.hidden))
    if (!menu.hidden) menu.querySelector('button')?.focus()
  })
  document.addEventListener('click', (event) => { if (!menu.hidden && !menu.contains(event.target) && event.target !== button && !button.contains(event.target)) closeMenu() })
  menu.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeMenu(); button.focus() } })
  for (const choice of menu.querySelectorAll('[data-fonte]')) {
    choice.addEventListener('click', () => {
      closeMenu()
      inputs[choice.dataset.fonte === 'camera' ? 'camera' : 'gallery'].click()
    })
  }

  function paint() {
    preview.hidden = items.length === 0
    preview.replaceChildren(...items.map((item, i) => {
      const remove = el('button', { type: 'button', className: 'previa-remover', textContent: '✕' })
      remove.setAttribute('aria-label', `Remover foto ${i + 1}`)
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(item.url)
        items.splice(items.indexOf(item), 1)
        paint()
      })
      const img = el('img', { src: item.url, alt: `Foto ${i + 1} para enviar` })
      return el('li', { className: 'previa-item' }, img, remove)
    }))
  }
  async function add(fileList) {
    for (const file of fileList) {
      if (!file.type.startsWith('image/')) continue
      if (items.length >= MAX_FILES) { notify(`No máximo ${MAX_FILES} fotos por mensagem.`); break }
      try {
        const { blob, width, height } = await shrinkImage(file)
        items.push({ blob, width, height, url: URL.createObjectURL(blob) })
      } catch {
        notify('Não consegui ler essa imagem.')
      }
    }
    paint()
  }
  for (const input of Object.values(inputs)) {
    input.addEventListener('change', async () => {
      await add([...input.files])
      input.value = '' // permite escolher o mesmo arquivo de novo
    })
  }

  return {
    count: () => items.length,
    /** `[{tipo, dados, largura, altura}]` no formato de `POST /api/chat/attachments`. */
    async take() {
      return Promise.all(items.map(async (i) => ({ tipo: i.blob.type, dados: await toBase64(i.blob), largura: i.width, altura: i.height })))
    },
    clear() {
      for (const item of items) URL.revokeObjectURL(item.url)
      items.length = 0
      paint()
    },
  }
}

const CITATION = /\n*\[anexo: chat\/anexos\/[^\]\n]+\]/g

/** Sem as linhas `[anexo: ...]` (elas existem para quem le so o jsonl; a tela mostra a imagem). */
export const textWithoutCitations = (message) => (message.anexos?.length ? String(message.texto).replace(CITATION, '').trim() : message.texto)

/** Miniaturas clicaveis (abrem a imagem inteira em outra guia); `width`/`height` reservam o espaco antes de carregar. */
export function attachmentsOf(message) {
  if (!message.anexos?.length) return null
  const box = el('div', { className: 'anexos' })
  message.anexos.forEach((a, i) => {
    const m = /^chat\/anexos\/(\d{4}-\d{2}-\d{2})\/([\w-]+\.\w+)$/.exec(a.arquivo)
    if (!m) return
    const img = el('img', { src: `/api/chat/anexos/${m[1]}/${m[2]}`, alt: `Imagem ${i + 1} enviada`, loading: 'lazy' })
    if (a.largura && a.altura) {
      img.width = a.largura
      img.height = a.altura
    }
    box.append(el('a', { href: img.src, target: '_blank', rel: 'noopener', className: 'anexo' }, img))
  })
  return box
}
