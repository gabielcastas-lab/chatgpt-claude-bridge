# ChatGPT + Claude Bridge

Servidor MCP remoto que expõe a ferramenta `ask_claude` para o ChatGPT chamar a Anthropic Messages API.

## O que faz

- MCP via Streamable HTTP em `POST /mcp`.
- Ferramenta `ask_claude` com prompt, modelo opcional e limite de tokens.
- Autenticação obrigatória por `Authorization: Bearer <MCP_AUTH_TOKEN>`.
- Segredo da Anthropic lido exclusivamente de `ANTHROPIC_API_KEY`.
- Endpoint de saúde `GET /health` sem expor segredos.
- Limite simples de 30 chamadas por minuto por IP.

## Variáveis de ambiente

Configure no painel do serviço de hospedagem; nunca coloque valores reais no Git:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Sim | Chave da Anthropic, guardada como Secret. |
| `MCP_AUTH_TOKEN` | Sim | Token aleatório longo para proteger o endpoint MCP. |
| `CLAUDE_MODEL` | Não | Modelo padrão. Padrão: `claude-sonnet-4-5`. |
| `PORT` | Não | Porta HTTP, normalmente fornecida pela hospedagem. |

## Rodar localmente

Requer Node.js 20+.

```bash
npm install
cp .env.example .env
# Preencha os valores apenas no seu ambiente local
npm start
```

## Deploy no Render

1. Crie um Web Service a partir deste repositório.
2. O arquivo `render.yaml` configura build, start e health check.
3. No painel do Render, adicione `ANTHROPIC_API_KEY` como Secret.
4. O Render gera `MCP_AUTH_TOKEN` automaticamente pelo `render.yaml`.
5. Não publique o token em mensagens, prints ou no repositório.
6. Depois do deploy, teste `https://SEU-SERVICO.onrender.com/health`.

## Conectar ao ChatGPT

Use a URL MCP `https://SEU-SERVICO.onrender.com/mcp` e a autenticação Bearer com o valor de `MCP_AUTH_TOKEN`, quando configurar um conector MCP compatível. Não compartilhe o token publicamente.

## Segurança e custos

- Não registre nem retorne chaves ou tokens.
- O limite de requisições em memória é básico e reinicia quando o processo reinicia; para uso público, adicione rate limiting persistente.
- Chamadas à API da Anthropic podem gerar custos. Confirme preços e orçamento com um responsável adulto antes de habilitar billing ou usar uma chave paga.
- O serviço não altera o modelo interno do ChatGPT; ele fornece uma ferramenta externa que o ChatGPT pode chamar.
