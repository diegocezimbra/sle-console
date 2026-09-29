// Chamadas ao daemon. `projeto=*` = visao de todos os projetos (a mesma do desktop).
const ALL_PROJECTS = '*'

export const withAllProjects = (path) => `${path}${path.includes('?') ? '&' : '?'}projeto=${encodeURIComponent(ALL_PROJECTS)}`

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function parse(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.erro || `erro ${response.status}`, response.status)
  return body
}

export const getJson = (path) => fetch(withAllProjects(path)).then(parse)

export const postJson = (path, body) =>
  fetch(withAllProjects(path), { method: 'POST', body: JSON.stringify(body) }).then(parse)

/** Resposta do Diego ao card: o mesmo caminho do modal do desktop (`option` e/ou `text`). */
export const answerCard = (id, { option = '', text = '' }) =>
  postJson(`/api/cards/${encodeURIComponent(id)}/answer`, { option, text })

export const CARDS_SUMMARY_PATH = '/api/cards?summary=1'
