# Estado da implementação

## Escopo vigente

Autorizado pelo usuário: criação por notícia, escrita manual ou dissertação informativa; hashtags sugeridas no corpo; prioridade editorial para notícias de tecnologia e novas vulnerabilidades; publicação somente texto, imagem única, galeria, GIF ou vídeo. PDF permanece fora do escopo. Integração OpenAI direta por SDK/API, sem Codex local. Este documento descreve o código, não comprovação de acesso às contas.

## Decisões aplicadas

- Fastify + React/Vite + TypeScript estrito, servidos na mesma origem local.
- SQLite com WAL, foreign keys, migração inicial, dados normalizados, revisões e tentativas persistidas.
- `better-sqlite3`, Zod, Sharp, `mp4box`, RSS parser, Readability/linkedom, jose e SDK OpenAI.
- Exportação ZIP com `yazl`; não há dependência ou endpoint de PDF.
- OpenAI: fluxo oficial de registro OAuth dinâmico, PKCE, state, nonce, validação JWT via JWKS, catálogo por conta, stream Responses e renovação serializada por lease entre processos.
- LinkedIn: OAuth/OIDC, identidade pessoal, PNG/GIF por Images API e MP4 por Videos API (partes, ETags e finalização). Consulta de disponibilidade de vídeo antes de criar; consulta de imagem não é exigida. Versão configurável, sem permissões presumidas.
- DPAPI CurrentUser no Windows, sem segredo de criptografia no repositório.
- CLI própria para geração manual/status/backup/restore.
- RSS é a base; busca web complementar não é requisito para executar e não é acionada automaticamente nesta versão.
- Geração de imagens manual por padrão, com prompt individual. Provedor de API paga opcional, explicitamente configurado e confirmado a cada uso.
- Migração v4 permite fonte/tópico opcionais, título próprio, modo editorial, novos formatos e metadados de mídia. Preserva revisões, tentativas e uploads. Migração v5 adiciona CERT-EU/BleepingComputer/Ars Technica sem reconfigurar fontes existentes.

## Fluxos implementados

- Coleta com proteção SSRF/DNS, janela móvel de sete dias, extração original e evidência de data.
- Modal acessível com assunto de até 500 caracteres, notícia/Manual/Dissertar, erro local e restauração de foco. Manual cria imediatamente mesmo offline ou com IA ocupada; texto vazio pode ser salvo, mas não aprovado.
- Dissertação explicativa sem RSS/notícia/fonte inventada. Dois modos de IA sugerem três hashtags; servidor compõe texto final dentro de 3.000 caracteres.
- Notícias padrão priorizam tecnologia e vulnerabilidades. Assunto explícito continua substituindo o foco editorial.
- Seleção por modelo com fontes delimitadas, histórico de eventos e validação do JSON; URL final inserida pela aplicação.
- Deduplicação por URL, chave de evento e similaridade de título. Lease evita duas gerações concorrentes. Cada solicitação manual inicia uma execução independente.
- Edição de texto, comparação com original, formato/quantidade, importação múltipla, ordem, remoção e prompts para substituição.
- Composição de título na arte, descrição alternativa, normalização de imagem e prévia.
- GIF preservado sem rasterização, até 250 quadros. MP4 validado por conteúdo, tamanho e duração; upload local em temporário com cleanup e revalidação de revisão. Arquivos de vídeo e ZIP por fluxo, previews com Range. Limites detalhados no README.
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
- `npm test`: **38 testes aprovados**, cobrindo migração com histórico/dependências, Manual offline, dissertação sem RSS, hashtags, GIF animado, limites e intervalos de amostras MP4, Range/ZIP, multipart remoto, reuso e resultado incerto, além de concorrência, revisão/aprovação, PDF, SSRF, OAuth, DPAPI e backup/restauração.
- `npm run build`: backend e frontend compilados.
- `npm run test:browser`: **9 testes aprovados** em Chromium, incluindo modal/assunto/erro/foco, Manual offline durante outra geração, preview de GIF/MP4, imagem única/galeria, ordem/substituição/overlay, aprovação/exportação, navegação, responsividade em 390 px e 1440 px e conexão LinkedIn.
- Screenshots desktop/mobile inspecionados; artefatos de teste em `test-results/` (ignorados no Git).
- `npm audit`: **zero vulnerabilidades reportadas** na instalação verificada.
- Os RSS de CERT-EU, BleepingComputer e Ars Technica responderam durante o planejamento da mudança. Isso não garante disponibilidade futura nem notícia recente em todo feed.
- A fixture MP4 automatizada valida contêiner/metadados, não decodificação de codec. A disponibilidade do arquivo real é confirmada no processamento remoto antes de criar o post.
- Revisão independente identificou e levou a corrigir falhas assíncronas de leitura do ZIP e tabelas de amostras MP4 inconsistentes. Testes em processo filho verificam que exportar mídia ausente/ilegível não encerra o servidor. Remover mídia após falha de upload também elimina referências de cache, preservando o snapshot da tentativa.

As requisições de inferência/publicação nos testes foram simuladas. Nenhuma conta pessoal foi autenticada, nenhuma chamada paga de geração foi realizada e nenhum post real foi publicado. O teste DPAPI usou somente credenciais fictícias e dados isolados.
