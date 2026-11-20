# Criação de publicações e mídias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar publicações por notícia, escrita manual ou dissertação, com hashtags, foco padrão em notícias de tecnologia/vulnerabilidades e suporte real a GIF/MP4.

**Architecture:** Reaproveitar o editor e a revisão otimista existentes. Separar modo editorial de formato de publicação e armazenar os tipos de mídia explicitamente; permitir posts sem notícia em vez de inventar fontes. Manter o fluxo remoto em fases de upload/criação com proteção contra duplicação.

**Tech Stack:** TypeScript, Fastify, SQLite/better-sqlite3, React 19, Sharp, OpenAI Responses, LinkedIn REST, node:test e Playwright. Acrescentar `mp4box` para inspecionar metadados MP4 no servidor sem exigir FFmpeg instalado.

**Spec:** `docs/superpowers/specs/2026-11-18-criacao-e-midias-design.md`

## Global Constraints

- Node.js >=22.12.0; aplicação local Windows; preservar sessão, CSRF, origem, leases e revisão otimista.
- Assunto normalizado com até 500 caracteres; dissertação exige assunto; notícia não exige.
- Texto final <=3.000 caracteres; IA sugere três hashtags no corpo; manual inicia vazio sem IA.
- Formatos: `text`, `single`, `gallery`, `gif`, `video`; modos: `news`, `manual`, `informative`.
- Galeria: 2 a 20 imagens estáticas; GIF único: <=250 quadros e <36.152.320 pixels/quadro; imagens/GIF <=20 * 1024 * 1024 bytes.
- MP4: 75.000 a 500.000.000 bytes, 3 a 1.800 segundos, com trilha de vídeo; upload/leitura por fluxo.
- Prioridade padrão: notícias atuais de tecnologia com grande destaque para novas vulnerabilidades e correções. Assunto explícito substitui esse foco.
- Testes nunca autenticam nem publicam em contas reais. Commits somente se solicitados pelo usuário.

## Review Focus

- Banco atualizado com revisões, tentativas e uploads antigos deve manter todos os relacionamentos e aprovações.
- Manual deve funcionar com IA desconectada e com outro job de IA em andamento; texto vazio salva, mas não aprova.
- GIF animado deve continuar animado após descrição, substituição, exportação e upload.
- MP4 com MIME/extensão falsos, metadados ausentes, duração inválida ou upload interrompido deve falhar sem deixar mídia persistida.
- Falha de upload/finalização/processamento de vídeo não pode disparar criação; timeout após criação deve bloquear novo envio como incerto.

---

### Task 1: Persistência de modos, formatos e fontes

**Files:** modificar `src/db.ts`, `src/posts.ts`, `src/app.ts`, `web/types.ts`, `tests/helpers.ts`, `tests/core.test.ts`, `tests/api.test.ts`.

**Interfaces:** `PostMode = 'news' | 'manual' | 'informative'`; `PostFormat = 'text' | 'single' | 'gallery' | 'gif' | 'video'`. `Post` ganha `title`, `mode` e fonte/data/evidência opcionais; `Media` ganha `kind: 'image' | 'gif' | 'video'`, `mime_type`, `duration_ms: number | null`. `createManualPost(db: Db, subject?: string): string` devolve ID persistido. `POST /api/posts` com `{subject?: string}` devolve Post e HTTP 201.

- [ ] Escrever testes de migração a partir do esquema v3 com post, mídia, revisão aprovada, tentativa/upload e execução. Asserções: IDs/texto/revisão/aprovação inalterados, modo `news`, mídia `image`/`image/png`, `db.pragma('foreign_key_check')` igual a `[]` após migrar e reabrir.
- [ ] Escrever testes de manual: criação 201 com `edited_text === ''`, `generated_text === ''`, `status === 'rascunho'`, `format === 'text'`, fonte nula e nenhuma chamada de autenticação/fetch; salvar vazio retorna 200; aprovar vazio retorna 400; aprovar texto não vazio sem mídia tem sucesso. Incluir lease de geração ativo na criação manual e revisão obsoleta recusada.
- [ ] Executar `npx tsx --test tests/core.test.ts tests/api.test.ts` e confirmar as novas falhas.
- [ ] Implementar migração v4 transacional de `posts` (tópico/notícia opcionais, título próprio preenchido das notícias antigas, modo e CHECK de formatos), colunas de mídia e modo nas execuções. Desativar FK apenas fora da transação para reconstruir a tabela, recriar índices, verificar FKs antes do commit e restaurar a configuração em `finally`.
- [ ] Atualizar consultas para LEFT JOIN, título próprio e fontes opcionais, preservando helpers antigos. Ajustar exclusão sem tópico/notícia. Criar manual sem linhas sintéticas em `topics`/`news` e permitir salvar vazio, mantendo validação na aprovação.
- [ ] Adicionar migração v5 de fontes com `INSERT ... ON CONFLICT(url) DO NOTHING`: CERT-EU e BleepingComputer prioridade 5, Ars Technica prioridade 4, URLs exatas da spec. Testar instalação nova, banco existente e preservação de enabled/priority após reabertura; ajustar testes antigos de contagem sem enfraquecer suas verificações.
- [ ] Reexecutar os testes da tarefa; resultado esperado: todos passam.

### Task 2: Geração informativa, hashtags e prioridade editorial

**Files:** modificar `src/generation.ts`, `src/openai.ts`, `tests/generation.test.ts`, `tests/core.test.ts`, `src/app.ts`; criar `src/editorial-policy.ts`.

**Interfaces:** preservar `generate(db, auth, count = 1, subject?, mode: 'news' | 'informative' = 'news')`. `generationSchema` ganha `mode` com default `news`. `informative(auth: Auth, model: string, subject: string, count: number): Promise<InformativeEditorial>` retorna `{title,text,hashtags,visualConcept,slides}`. `Editorial` de notícia ganha `hashtags: string[]` (exatamente 3). `composeEditorialText(text: string, hashtags: string[], sourceUrl?: string): string` valida hashtags sem espaços, normaliza prefixo `#`, evita duplicatas, anexa-as antes da fonte e recusa resultado >3.000 caracteres. Não truncar silenciosamente.

- [ ] Escrever testes SSE simulados: dissertação sobre Kubernetes funciona com feeds desabilitados e sem requisição RSS, registra `informative`, não cria notícia/tópico e retorna rascunho informativo com três hashtags. Assunto vazio/espaços ou modo inválido é recusado antes de criar run.
- [ ] Testar notícia sem assunto: instruções cobrem notícias gerais de tecnologia e dão destaque a vulnerabilidades; notícia com assunto mantém override. Manter deduplicação, sete dias, `sem_pauta` e fonte fornecida pela aplicação. Testar falhas de feed sem gerar outra pauta fora do assunto.
- [ ] Testar saída com três hashtags, tags inválidas/duplicadas, 3.000 e 3.001 caracteres após composição e stream incompleto. Atualizar fixtures SSE antigas para o novo contrato.
- [ ] Executar `npx tsx --test tests/generation.test.ts tests/core.test.ts` e confirmar falhas novas.
- [ ] Extrair apenas streaming/parse comum em `src/openai.ts`; prompts distintos para notícia e dissertação. Colocar foco padrão e composição final em `src/editorial-policy.ts`. Dados de assunto/fontes continuam dados não confiáveis, separados das instruções.
- [ ] Ramificar `generate` antes de `collect` para modo informativo; conservar lease, erros, progresso e histórico. API mantém 202 para IA e backward compatibility para CLI sem `mode`.
- [ ] Reexecutar testes da tarefa; resultado esperado: todos passam.

### Task 3: Validação e armazenamento real de GIF/MP4

**Files:** criar `src/media.ts`, `tests/media.test.ts`; modificar `src/posts.ts`, `src/app.ts`, `package.json`, `package-lock.json`, `tests/api.test.ts`; criar fixtures locais em `tests/fixtures/` quando necessárias.

**Interfaces:** `inspectVideo(filePath: string): Promise<{width: number; height: number; durationMs: number; size: number}>`; `addVideoFile(db: Db, dataDir: string, postId: string, revision: number, temporaryPath: string, description?: string): Promise<string>`. Preservar `addMedia` para imagens/GIF por bytes limitados a 20 MiB, roteando GIF pela assinatura real. `Media.kind/mime_type/duration_ms` seguem tarefa 1.

- [ ] Escrever testes: GIF de dois quadros mantém bytes e páginas após importação/descrição/substituição; 251 quadros ou dimensões excessivas falham; overlay em GIF/vídeo é recusado. JPG/PNG/WebP continuam normalizados e PDF recusado.
- [ ] Escrever testes de MP4 com trilha/duração válidas e inválidas: tamanho 74.999/500.000.001, duração abaixo de 3/acima de 1.800 segundos, áudio sem vídeo, cabeçalho truncado e nome/MIME MP4 com conteúdo inválido. Usar fixtures mínimas e simular stat para limites grandes sem gerar 500 MB em testes.
- [ ] Escrever testes API de upload interrompido, revisão alterada durante inspeção e conflito com mídia existente; falha não deixa arquivo/registro. Testar GET MIME correto e Range `bytes=0-99` =>206/100 bytes, sufixo e intervalo inválido =>416.
- [ ] Executar `npx tsx --test tests/media.test.ts tests/api.test.ts` e confirmar falhas novas.
- [ ] Instalar `mp4box` compatível com Node suportado após conferir sua API; ler metadados por blocos com limite e cleanup, sem extrair samples nem carregar o MP4 inteiro. Validar trilha, dimensões e duração finita no servidor.
- [ ] Encaminhar multipart de vídeo para temporário por pipeline com limite de 500.000.000 bytes; manter limites próprios de imagem/GIF. Revalidar revisão e combinação de formato antes de anexar; não excluir mídias do usuário automaticamente ao trocar formato.
- [ ] Implementar Range e streaming no GET de mídia, `media-src 'self' blob:` no CSP, exportação ZIP com extensão/MIME corretos e `addFile` para vídeo. Atualização de descrição não rasteriza GIF/vídeo; substituição preserva tipo exigido pelo formato.
- [ ] Atualizar aprovação por formato: `text` sem arquivos/count 0; `single` uma imagem; `gallery` 2..20 imagens; `gif` um GIF/count 1; `video` um vídeo/count 1. Imagens/GIF exigem alt; validar combinações também na mutação e geração paga de imagem.
- [ ] Reexecutar testes da tarefa; resultado esperado: todos passam.

### Task 4: Publicação LinkedIn por tipo de mídia

**Files:** modificar `src/linkedin.ts`, `src/posts.ts`, `tests/core.test.ts`; criar `tests/linkedin-media.test.ts`.

**Interfaces:** manter `linkedinBody(author, text, assets)` compatível com imagens existentes; assets de vídeo carregam URN `urn:li:video:*`, com corpo `content.media.id` sem `altText` de imagem. Lista vazia omite `content`. `publish` mantém assinatura e reaproveitamento dos uploads por revisão.

- [ ] Escrever testes de corpo texto, imagem única, galeria, GIF e vídeo, preservando escape de commentary e hashtags.
- [ ] Simular initialize de vídeo com duas partes; verificar limites inclusivos dos bytes, PUT de cada parte, ETags na ordem, `uploadToken` e finalize com URN exata. Somente depois pode existir POST `/rest/posts`.
- [ ] Testar URL não HTTPS/domínio externo, intervalos sobrepostos/fora do arquivo, ETag ausente, finalize recusado e status de processamento não disponível. Nenhum desses casos pode criar post remoto. Reuso de upload finalizado evita reenviar bytes após falha definitiva de criação.
- [ ] Testar hash divergente após aprovação e timeout em `/rest/posts`: não repetir criação e registrar outcome `unknown`, como no fluxo atual.
- [ ] Executar `npx tsx --test tests/linkedin-media.test.ts tests/core.test.ts` e confirmar falhas novas.
- [ ] Implementar imagens/GIF por `/rest/images` com MIME correto; vídeo por `/rest/videos` com validação estrita das instruções, upload das partes por fluxo, ETags, finalização e verificação de processamento quando autorizada. Não exigir GET de imagens com `w_member_social`; recusa de consulta de vídeo deve resultar em erro claro antes de criar, sem fallback silencioso de permissão.
- [ ] Renovar lease durante partes/processamento. Registrar uploaded somente após finalizar; manter estados uploading/creating e resultado incerto. Hash de vídeo calculado por fluxo; snapshot inclui tipo/MIME/duração.
- [ ] Reexecutar testes da tarefa; resultado esperado: todos passam.

### Task 5: Modal e editor multimídia

**Files:** criar `web/GenerationDialog.tsx`, `web/MediaPreview.tsx`; modificar `web/main.tsx`, `web/types.ts`, `web/publications.css`, `web/style.css`, `tests/browser.spec.ts`.

**Interfaces:** `GenerationDialog` recebe estado de IA ocupada/conectada, `onCancel`, `onManual(subject): Promise<void>` e `onGenerate(mode, subject): Promise<void>`. `MediaPreview` recebe mídia e exibe `<img>` para image/GIF ou `<video controls preload="metadata">` para vídeo; card usa vídeo sem controles interativos dentro do botão existente.

- [ ] Adaptar teste de assunto para modal: campo ausente antes de abrir, três opções visíveis, maxlength 500, assunto enviado apenas nas opções com IA; notícia vazia mantém defaults; dissertação vazia não dispara request; erro conserva assunto.
- [ ] Adicionar teste manual offline com geração ocupada: botão abre modal, Manual cria rascunho e abre editor vazio; salvar texto, recarregar e aprovar texto sem mídia funciona.
- [ ] Cobrir teclado/foco/Escape/retorno ao acionador, desktop 1440px e mobile 390px sem overflow. Verificar mensagens de temas padrão mencionam tecnologia/vulnerabilidades.
- [ ] Adicionar fluxos de importação GIF/MP4, preview correto, opções incompatíveis bloqueadas sem apagar arquivos e descrição sem overlay nesses tipos. Adaptar testes de galeria/reordenação/substituição/exportação para nomes novos, preservando asserções existentes.
- [ ] Executar os testes novos de navegador contra o build corrente e confirmar falhas de UI esperadas.
- [ ] Implementar dialog isolado com erros locais e reset somente após sucesso. Abrir a partir dos dois botões de criação; permitir Manual durante job de IA. Tirar o formulário de assunto da página principal.
- [ ] Ampliar formato/count (0 para texto), labels, cards, campos de fonte opcionais, preview e accept de arquivos. Validar tipo/limite no cliente como conveniência; servidor continua autoridade. Botões de arte/overlay só para imagens estáticas.
- [ ] Atualizar execuções com modo e assunto. Conservar estilo visual existente e labels em pt-BR, usando a grafia **Dissertar (IA)**.
- [ ] Executar `npm run check`, `npm run build` e `npm run test:browser`; resultado esperado: todos passam, salvo skips documentados já condicionados à configuração local.

### Task 6: Documentação e verificação integrada

**Files:** modificar `README.md`, `docs/implementacao.md` e `product.md` nas seções afetadas.

- [ ] Documentar os três modos, hashtags, prioridade editorial, novas fontes, formato somente texto, GIF/MP4, limites locais versus API, upload/processamento de vídeo e exportação. Remover afirmações antigas de exclusividade AI/Cloud e de somente imagens estáticas.
- [ ] Executar `npm run check`, `npm test`, `npm run build`, `npm run test:browser` e conferir saídas completas. Corrigir regressões com diagnóstico antes de alterar código.
- [ ] Revisar `git diff --check`, `git diff --stat` e diff completo, cobrindo cada seção da spec, especialmente migração, limpeza de temporários e nenhuma publicação real.
- [ ] Registrar resultados e eventuais limitações concretas. Não criar commit sem solicitação.

## Auto-revisão do plano

Cobertura: modos, modal, hashtags e prioridades na tarefa 2/5; manual e migrações na 1; validação/armazenamento/exportação na 3; upload remoto na 4; documentação e verificações na 6. As cinco condições de Review Focus têm testes na tarefa responsável. A CLI mantém a chamada antiga graças ao argumento `mode` com default, e o compartilhamento de tipos da tarefa 1 orienta as posteriores.

Execução recomendada: direta nesta sessão, tarefa por tarefa, pois a migração de dados, os contratos da API e o editor compartilham interfaces e os testes podem validar cada etapa integrada.

## Resultado da execução — 18/11/2026

As seis tarefas foram implementadas sequencialmente e verificadas. TypeScript e build aprovados; 38 testes de backend/integração e 9 testes de navegador aprovados. Revisão independente realizada, com correções de exportação ZIP, integridade estrutural de amostras MP4 e remoção de mídia com cache de upload. Dados de teste isolados; integrações externas simuladas. Alterações mantidas sem commit na branch `feat/criacao-e-midias`.
