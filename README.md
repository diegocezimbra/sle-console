# SLE Console

Observa, em tempo real, o Sistema de Loops de Engenharia rodando na sua máquina:
quais agentes estão vivos, o que cada um está fazendo agora, e em que escala de
tempo cada coisa acontece.

Seis telas: **Fluxo** (o que está acontecendo agora), **Board** (os cards),
**Editar** (gates, prompts, agentes), **Controle** (rodar agentes, parada de
emergência), **Métricas** (o grafo de iteração e os números do método) e
**Histórico** (por dia: o que foi entregue, quem trabalhou, quanto custou).

```bash
git clone https://github.com/diegocezimbra/sle-console && cd sle-console
node bin/sle.js
# sle console  http://127.0.0.1:7717
```

Não está no npm ainda — nada a instalar, nada a compilar: é Node e mais nada.

Custo e tokens (opcional), pelo receptor OTLP na porta seguinte:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json   # protobuf exigiria dependência
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:7718
```

Para alimentar, aponte os hooks do Claude Code para o daemon:

```json
{ "type": "command",
  "command": "curl -s -X POST http://127.0.0.1:7717/api/hook --data-binary @-" }
```

Todo hook de ingestão sai com 0, sempre. **Observabilidade nunca bloqueia
execução** — um hook que morre não pode derrubar sua sessão de trabalho.

## As telas

| tela | responde |
|---|---|
| **Fluxo** | quem está vivo · a régua de loops (um traço por evento, uma faixa por escala de tempo: L1 turno, L2 etapa, L3 card) · o que está executando agora, com duração, falha em vermelho |
| **Board** | os cards por coluna do pipeline, risco visível sem abrir; clicar abre a spec |
| **Editar** | gates, prompts, agentes e cards, com validação antes de gravar e um **Testar agora** que roda o comando de verificação de verdade |
| **Controle** | cada agente com papel e modelo, botão de rodar, quem está rodando, teto de gasto e **parada de emergência**. Maker e checker no mesmo modelo aparecem em alerta — o mesmo modelo tende a aprovar o próprio tipo de erro |
| **Métricas** | grafo de iteração maker↔checker, turnos por card, reprovações por gate, taxa de escalonamento, tempo de review humano e custo por card |
| **Histórico** | por data: o que foi **entregue** (chegou em `done`), o que só andou de coluna, quais agentes trabalharam, quantas reprovações e o custo de cada card |

## O que o daemon recusa fazer

Estas não são configurações, são limites do desenho:

- **escrita só em `cards/`, `sle/` e `docs/`** — `..`, caminho absoluto,
  `.git/` e symlink apontando para fora são recusados **antes** de tocar o
  disco, e o symlink é resolvido de verdade, não conferido pela string;
- **conteúdo inválido não chega ao disco** — JSON quebrado, gate com modo
  inexistente ou agente que executa etapa *e* aprova gate voltam 422 com o
  motivo, e o arquivo bom continua lá;
- **o comando de um agente vem da configuração, nunca da requisição** — a API
  aceita o *id* de um agente e nada mais. Um endpoint que aceitasse comando
  seria execução remota de código com nome bonito;
- **gate que o daemon não sabe avaliar para o pipeline** em vez de liberar —
  falha fechada, nunca aberta;
- **a condição de um `auto_unless` não é avaliada como expressão.** Só o
  formato `card.<campo> == '<valor>'` é reconhecido; o resto é ignorado, porque
  avaliar texto de um arquivo editável pela UI é executar código de terceiros
  dentro do daemon;
- **a parada de emergência mata o grupo de processos**, não só o filho direto —
  parada que deixa neto vivo não é parada;
- **dado que não chegou não vira zero.** Toda métrica devolve `{valor, estado}`,
  e quando não há valor a tela mostra o motivo — "aguardando flush de
  telemetria", "fora do console". Zero é uma afirmação; ausência de dado não é.

## Arquitetura

O disco é a verdade; a memória é um índice descartável sobre ele.

- **`node:http` puro, zero dependências.** Numa ferramenta que fica no meio do
  seu ambiente de trabalho, cada dependência é superfície de ataque
- **SSE**, não WebSocket: unidirecional serve e reconecta sozinho
- **JSONL append-only** em `sle/runtime/events.jsonl`. Apagar o índice e
  reiniciar reconstrói tudo — é por isso que não há banco: seria uma segunda
  fonte para dessincronizar
- **Front sem framework e sem build step.** A régua é Canvas 2D à mão, porque é
  um analisador lógico, não um gráfico de biblioteca

## Testes

```bash
npm test     # node:test embutido — zero dependência, inclusive nos testes
```

Cobrem ingestão, estado (append-only, remontagem após reinício, linha
corrompida), cards e frontmatter, git, watcher, contenção de escrita,
validação, motor de gates, runner — e **a interface num Chrome de verdade**.

Os testes de interface falam CDP pelo `WebSocket` nativo do Node
(`test/apoio/browser.js`, ~140 linhas), então rodam num browser real sem
`devDependencies`. Sem Chrome na máquina, eles se declaram pulados em vez de
falhar.

Vale por dois defeitos que só eles pegam: um `const` usado antes da declaração,
que quebrava o primeiro paint inteiro sem um único sinal no servidor; e um 404
de favicon em todo carregamento. O servidor respondia 200 nos dois casos.

A especificação completa das quatro fases não faz parte deste repositório —
ela é o documento de método de onde este daemon saiu.

## Relacionados

- [`ai-warden`](https://github.com/diegocezimbra/ai-warden) — o outro consumidor
  do mesmo hook: em vez de pintar tela, impede uma sessão de destruir o
  trabalho da outra
- [`ai-memory`](https://github.com/akitaonrails/ai-memory) — memória persistente
  entre agentes. Os três convivem no mesmo evento de hook, sem se falarem
