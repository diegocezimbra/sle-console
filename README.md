# SLE Console

Observa, em tempo real, o Sistema de Loops de Engenharia rodando na sua máquina:
quais agentes estão vivos, o que cada um está fazendo agora, e em que escala de
tempo cada coisa acontece.

**Fase 1 — Ver.** Só observação: não existe um único endpoint que escreva no seu
repositório.

```bash
npx sle          # ou: node bin/sle.js
# sle console  http://127.0.0.1:7717
```

Para alimentar, aponte os hooks do Claude Code para o daemon:

```json
{ "type": "command",
  "command": "curl -s -X POST http://127.0.0.1:7717/api/hook --data-binary @-" }
```

Todo hook de ingestão sai com 0, sempre. **Observabilidade nunca bloqueia
execução** — um hook que morre não pode derrubar sua sessão de trabalho.

## O que a tela mostra

| painel | responde |
|---|---|
| **Agentes** | quem está vivo, quantos eventos, encerrado ou não |
| **Régua de loops** | um traço por evento, uma faixa por escala de tempo: L1 turno (segundos), L2 etapa e sessão (minutos), L3 card (horas) |
| **Fluxo ao vivo** | o que está sendo executado agora, com duração; falha em vermelho |

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
npm test     # node:test, embutido — 23 testes, zero dependência
```

Cobrem a normalização de payload, o estado (append-only, remontagem após
reinício, linha corrompida) e o daemon por HTTP real (ingestão, SSE, snapshot,
404 em rota desconhecida).

**A interface não tem teste automatizado** — testá-la exigiria um browser, e
browser é dependência. A verificação é visual, e ela já pegou um defeito que
nenhum teste de servidor pegaria: um `const` usado antes da declaração quebrava
o primeiro paint inteiro sem qualquer sinal no servidor.

## Fases seguintes

2 — Ler (cards, board, git) · 3 — Editar (gates, prompts, agentes) ·
4 — Controlar (runner, modelos por agente, parada de emergência).

Especificação completa em [`../docs/sle-console-especificacao.md`](../docs/sle-console-especificacao.md).
