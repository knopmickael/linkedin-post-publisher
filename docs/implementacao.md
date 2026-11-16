# Estado da implementação

## Escopo vigente

Autorizado pelo usuário: implementar a aplicação completa com **uma ou mais imagens no post**, suspendendo PDF. Integração OpenAI direta por SDK/API, sem Codex local. O restante deste documento descreve o código entregue, não comprovação de acesso às contas.

## Decisões aplicadas

- Fastify + React/Vite + TypeScript estrito, servidos na mesma origem local.
- SQLite com WAL, foreign keys, migração inicial, dados normalizados, revisões e tentativas persistidas.
- `better-sqlite3`, Zod, Sharp, RSS parser, Readability/linkedom, jose e SDK OpenAI.
- Exportação ZIP com `yazl`; não há dependência ou endpoint de PDF.
- OpenAI: fluxo oficial de registro OAuth dinâmico, PKCE, state, nonce, validação JWT via JWKS, catálogo por conta, stream Responses e renovação serializada por lease entre processos.
- LinkedIn: OAuth/OIDC, verificação da identidade pessoal via userinfo, upload de PNG e criação orgânica single/MultiImage, versão configurável, sem permissões presumidas de leitura.
- DPAPI CurrentUser no Windows, sem segredo de criptografia no repositório.
- CLI própria para geração manual/status/backup/restore.
- RSS é a base; busca web complementar não é requisito para executar e não é acionada automaticamente nesta versão.
- Geração de imagens manual por padrão, com prompt individual. Provedor de API paga opcional, explicitamente configurado e confirmado a cada uso.

## Fluxos implementados

- Coleta com proteção SSRF/DNS, janela móvel de sete dias, extração original e evidência de data.
- Seleção por modelo com fontes delimitadas, histórico de eventos e validação do JSON; URL final inserida pela aplicação.
- Deduplicação por URL, chave de evento e similaridade de título. Lease evita duas gerações concorrentes. Cada solicitação manual inicia uma execução independente.
- Edição de texto, comparação com original, formato/quantidade, importação múltipla, ordem, remoção e prompts para substituição.
- Composição de título na arte, descrição alternativa, normalização de imagem e prévia.
- Aprovação da revisão exata; invalidação ao alterar; bloqueio de edição durante envio e após publicação.
- Publicação sob clique, snapshot e hash dos arquivos; tentativas incertas bloqueiam reenvio e exigem conferência.
- Histórico de posts/execuções, configurações das integrações e feeds.
- Exportação para publicação manual, backup SQLite + mídias e restauração em novo destino.

## Validação de contas: pendente do usuário

Nenhuma geração foi cobrada nem publicação real foi feita durante a implementação. Para completar as POCs, o usuário precisa autenticar OpenAI/LinkedIn, escolher modelo, gerar um rascunho e publicar explicitamente cada formato que deseja validar.

O catálogo/scopes/formatos dependem da conta e da versão da documentação. OAuth pode falhar por elegibilidade, configuração do portal ou callback HTTPS; o produto preserva dados e não muda silenciosamente para API paga.

## Pontos operacionais

- A geração de rascunhos é iniciada pelo usuário pelo botão **Gerar agora** ou pela CLI. Não há geração automática por horário.
- Recursos indisponíveis na conta continuam exportáveis manualmente.
- As referências históricas a PDF nos planos anteriores estão suspensas, não fazem parte da interface implementada.

Instruções, comandos e procedimentos atuais: [README](../README.md).

### Correção do workspace

Os cartões ChatGPT/LinkedIn agora usam rótulos próprios de conexão (Conectado/Não conectado), sem reutilizar Rascunho/Aprovado. O fluxo LinkedIn permite preencher as duas credenciais e clicar em Salvar e conectar no próprio cartão; a API valida e protege os valores antes de preparar a autorização. Com credenciais armazenadas, o botão Conectar fica disponível. Campos incompletos mantêm o botão desabilitado com explicação visível.

## Verificações executadas

- `npm run check`: TypeScript do backend e frontend aprovado.
- `npm test`: **14 testes aprovados**, incluindo concorrência, revisão/aprovação, rejeição de PDF, SSRF, stream OpenAI completo/incompleto, renovação OAuth simulada, DPAPI real no Windows, publicação simulada e backup/restauração.
- `npm run build`: backend e frontend compilados.
- `npm run test:browser`: **3 testes aprovados** em Chromium, cobrindo imagem única, galeria, importação múltipla, ordem, substituição, título na arte, aprovação, exportação, navegação, ausência de overflow em 390 px e 1440 px e configuração/conexão LinkedIn sem depender do botão geral de salvar.
- Screenshots desktop/mobile inspecionados; artefatos de teste em `test-results/` (ignorados no Git).
- `npm audit`: **zero vulnerabilidades reportadas** na instalação verificada.
- Os cinco feeds iniciais responderam e foram interpretados como RSS/Atom. Conteúdo de artigo do Spring foi buscado e extraído com Readability. Isso não garante disponibilidade futura nem notícia recente em todo feed.

As requisições de inferência/publicação nos testes foram simuladas. Nenhuma conta pessoal foi autenticada, nenhuma chamada paga de geração foi realizada e nenhum post real foi publicado. O teste DPAPI usou somente credenciais fictícias e dados isolados.
