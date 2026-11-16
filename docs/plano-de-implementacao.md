# Plano de implementação

Data: 16/11/2026. Estado: **proposta aguardando revisão**. Requisitos: [`../product.md`](../product.md).

**Documento histórico:** a implementação foi autorizada posteriormente, retirando PDF do escopo. Referências abaixo a PDF representam propostas suspensas. Estado vigente: [implementacao.md](implementacao.md) e [README](../README.md).

Regra confirmada após o plano inicial: integração OpenAI direta por SDK/API, sem Codex local. Usar cota Plus depende de OAuth com consentimento e elegibilidade; não existe API key convencional incluída no Plus. Geração de imagem não é suportada pela modalidade atual. Ver [revisão da integração](revisao-integracao-openai.md).

## 1. Arquitetura

Monólito modular em Node.js e TypeScript, com duas entradas: servidor HTTP local e CLI de geração manual. Ambos compartilham serviços e persistência. A CLI não depende do servidor.

```text
Navegador → servidor local → edição, aprovação, OAuth e publicação
                          → serviço de geração compartilhado
Usuário → CLI             → serviço de geração compartilhado

Serviços: coleta → verificação → seleção/deduplicação → texto → mídias
Persistência: SQLite + arquivos locais
```

Stack e justificativas: [decisões técnicas](decisoes-tecnicas.md). Integrações condicionadas às [POCs](provas-de-conceito.md).

Estrutura prevista:

```text
src/
  server/
  cli/
  domain/
  services/
  integrations/
    openai/
    linkedin/
    news/
  persistence/
  media/
web/
migrations/
scripts/windows/
```

Persistência local proposta:

```text
%LOCALAPPDATA%\LinkedInPostPublisher\
  database.sqlite
  media\
  exports\
  logs\
  config.json
```

Configuração variável validada na inicialização. Segredos em armazenamento protegido pelo Windows e referências no banco. Caminhos de mídia relativos à raiz dos dados. Versões e dependências fixadas com lockfile. Build separado da execução: a CLI executa JavaScript compilado, não instala nem compila dependências.

## 2. Pesquisa e geração

1. Registrar execução e adquirir trava de geração com prazo e heartbeat.
2. Coletar feeds habilitados, usando cache HTTP quando disponível.
3. Filtrar janela móvel de sete dias com referência em `America/Sao_Paulo`.
4. Buscar fonte original e verificar data, conteúdo e evidências.
5. Normalizar URLs; agrupar coberturas do mesmo evento.
6. Priorizar fonte oficial, tema, novidade, impacto prático e evidência suficiente.
7. Comparar pauta com todo o histórico persistido.
8. Gerar texto e plano visual estruturados; validar contrato e conteúdo.
9. Persistir rascunho e revisão.
10. Preparar conceito visual e aceitar importação manual das imagens. Geração pela API paga só quando explicitamente habilitada; falha de imagem não descarta texto válido.
11. Registrar resultado, liberar trava e finalizar.

Sem pauta verificável: execução concluída como `sem_pauta`, sem post. Falhas de coleta, autenticação, cota e validação têm diagnóstico próprio. A interface deve continuar permitindo trabalhar em conteúdo existente.

Foco de pesquisa: AI (novos modelos, empresas e toda novidade relevante para desenvolvedores e/ou investidores), Cloud, System Design, arquitetura de software, performance e escalabilidade. Fontes iniciais: OpenAI, Google DeepMind, Hugging Face, NVIDIA, TechCrunch AI, AWS, Google Cloud, AWS Architecture, Cloudflare e Netflix Engineering. Priorizar fontes primárias para anúncios e dados; complementar o contexto de empresas e mercado com cobertura jornalística. A disponibilidade e as datas dos feeds são verificadas em cada coleta. Busca web só complementa a coleta quando disponível.

Deduplicação:

- Remover fragmentos e parâmetros de rastreamento conhecidos; preservar parâmetros significativos.
- Manter URL original e URL canônica, com regras controladas de normalização.
- Chave de evento por produto, versão e mudança anunciada.
- Similaridade de título/resumo como apoio editorial, sem depender apenas de uma classificação do modelo.
- Restrições únicas e transações garantem exclusão concorrente após a identificação do evento.

## 3. Modelo SQLite

Esquema conceitual; tipos, DDL e detalhes das migrações serão definidos na implementação.

| Tabela | Campos principais |
| --- | --- |
| `feeds` | `id`, `name`, `url`, `priority`, `enabled`, `etag`, `last_modified`, `last_checked_at` |
| `news_items` | `id`, `original_url`, `canonical_url`, `title`, `published_at`, `date_evidence`, `content_hash`, `excerpt`, `fetched_at`, `topic_id` |
| `topics` | `id`, `event_key`, `normalized_title`, `product`, `release_version`, `summary` |
| `generation_runs` | `id`, `trigger`, `started_at`, `finished_at`, `status`, `stage`, `provider`, `error_code`, `error_message` |
| `posts` | `id`, `topic_id`, `primary_news_id`, `generation_run_id`, `generated_text`, `edited_text`, `format`, `status`, `revision`, `approved_revision_id`, `linkedin_post_urn`, timestamps |
| `post_revisions` | `id`, `post_id`, `revision`, `text`, `format`, `media_manifest_json`, `content_hash`, `created_at` |
| `media_assets` | `id`, `post_id`, `relative_path`, `kind`, `position`, `alt_text`, `overlay_text`, `prompt`, `provider`, `sha256`, dimensões, tamanho, `status` |
| `publication_attempts` | `id`, `post_id`, `revision_id`, `request_hash`, `stage`, `outcome`, `http_status`, `linkedin_post_urn`, erro e timestamps |
| `linkedin_uploads` | `id`, `attempt_id`, `media_asset_id`, `asset_urn`, `status`, `expires_at` |
| `integration_connections` | `id`, `provider`, `account_identifier`, `scopes`, `expires_at`, `secret_reference`, `capabilities_json` |
| `job_leases` | `name`, `owner`, `expires_at`, `heartbeat_at` |
| `schema_migrations` | versão e data da migração |

Relações: itens de notícia pertencem a pautas; posts apontam para pauta e fonte primária; revisões e mídias pertencem ao post; tentativas apontam à revisão enviada; uploads pertencem às tentativas e mídias.

Invariantes:

- URL canônica e chave de evento únicas.
- Um post por pauta no escopo inicial.
- Gerações manuais independentes, sem limite de uma execução por dia.
- Uma tentativa ativa de publicação por post.
- Revisão aprovada pertence ao próprio post e corresponde ao conteúdo atual.
- Controle otimista de revisão impede sobrescrita por abas concorrentes.
- `foreign_keys=ON`, WAL, `busy_timeout` e índices para filtros/relações.
- Transações curtas; chamadas de rede e modelo fora de transações.
- Trava expirada pode ser recuperada; transação confirma exclusividade antes de persistir.
- Arquivos são escritos em temporário e promovidos antes da referência final; prever limpeza de órfãos sem apagar mídia referenciada.

Backups devem capturar um snapshot consistente do SQLite e as mídias referenciadas. Não copiar apenas o arquivo principal de um banco WAL ativo. Validar restauração.

## 4. Estados e publicação

```text
rascunho → aprovado → publicando → publicado
                           └────→ falha
```

- Aprovação vinculada a texto, formato e manifesto de mídias da revisão.
- Alteração após aprovação retorna o conteúdo a rascunho e exige nova aprovação.
- Servidor confirma aprovação e adquire exclusividade antes de enviar.
- Conteúdo enviado permanece congelado durante a tentativa.
- Geração iniciada pelo usuário cria somente rascunho.
- Falhas conhecidas podem ser corrigidas; nova tentativa sempre respeita aprovação e resultado anterior.

### Resultado incerto

Timeout, conexão interrompida ou processo morto após iniciar a criação podem significar que o LinkedIn publicou. Registrar `outcome=unknown`, exibir “Resultado incerto — verifique no LinkedIn” e impedir repetição automática.

O usuário poderá associar o post encontrado ou confirmar sua ausência antes de tentar novamente. Recuperação de uma tentativa interrompida na etapa de criação segue essa mesma regra. Uma chave local impede cliques concorrentes, mas não garante criação exatamente uma vez no LinkedIn. Não presumir permissão de leitura para reconciliação.

## 5. Mídias

- Padrão: imagem única; quantidade por publicação validada no servidor.
- Galeria/PDF com conceito visual comum e pontos editoriais diferentes.
- Base ilustrada separada de títulos/dados aplicados por template.
- Preservar originais e versões anteriores; caminhos/hashes da revisão aprovada ficam estáveis.
- Reordenar, substituir, importar, regenerar individualmente e editar descrição alternativa.
- Recriar PDF ao mudar ordem, arte ou texto.
- Incluir texto real no PDF quando possível; validar acessibilidade do documento separadamente, sem presumir que `alt_text` do banco é transmitido pelo formato.
- Enviar texto alternativo onde a API permitir.
- Exportar texto, imagens numeradas, PDF quando aplicável e descrições alternativas.

## 6. Telas

### Início e histórico

Botão Gerar agora, lista de posts com estado/data/tema/miniatura, filtros por estado/período, última execução, próximo horário e estado das integrações. Evidenciar rascunhos com mídia pendente.

### Editor

Fonte original e data, texto gerado e editado, contador conforme limite validado da API, formato/quantidade, editor de mídias, prévia e ações Salvar/Aprovar/Publicar/Exportar. Imagens podem ser movidas também por teclado.

### Execuções

Execuções manuais, etapas, duração, motivos de descarte, resultado sem pauta e erros de sessão/cota/rede. Diagnóstico sem segredos.

### Configurações

Feeds, temas, provedores, ativação explícita da API paga, conexão LinkedIn, capacidade por formato, caminhos e backup.

Interface com estados vazios, carregamento, erro e sucesso; navegação por teclado, foco visível, labels e contraste adequado. Verificação futura em desktop e largura móvel, incluindo conteúdo longo.

## 7. Operação no Windows

A geração é iniciada exclusivamente pelo usuário, no painel ou pela CLI:

```powershell
node dist/cli.js generate --count 1
```

Usar o mesmo usuário Windows que autorizou as contas para acessar as credenciais protegidas por DPAPI. Não há geração automática por horário nem exigência de fuso específico do Windows.

Logs estruturados para stdout/stderr e histórico operacional no SQLite. Encerramento deve finalizar etapas seguras, liberar recursos e preservar tentativas incertas sem reenviá-las.

## 8. Etapas e critérios de aceite

| Etapa | Entrega | Aceite principal |
| --- | --- | --- |
| 1 | POC OpenAI SDK/API: OAuth/cota Plus, texto e importação de imagem | Elegibilidade, JSON, renovação e geração manual; geração de imagem não suportada nessa modalidade |
| 2 | POC LinkedIn: três formatos | Upload e criação real apenas pelo clique do usuário |
| 3 | Base TypeScript, servidor, banco e arquivos | Inicialização, migrações, configuração validada e persistência |
| 4 | Coleta, verificação e deduplicação | Sem fonte válida não gera; concorrência não duplica |
| 5 | Geração editorial e falhas | Contrato válido; texto preservado se imagem falhar |
| 6 | Painel e mídias | Revisão, importação, ordem, acessibilidade e aprovação |
| 7 | Publicação e exportação | Envio da revisão correta, exclusividade e tratamento de resultado incerto |
| 8 | CLI manual, backup e documentação | Geração pela CLI e restauração comprovada |

Prioridade: imagem única como primeiro fluxo completo; depois galeria e PDF segundo capacidades verificadas.

### Verificações prioritárias

- Solicitações manuais simultâneas pelo painel e pela CLI.
- Mesma pauta em URLs/fontes diferentes.
- Data fora da janela, ausente ou sem evidência suficiente.
- Sessão expirada, cota esgotada e saída inválida do gerador.
- Edição após aprovação e atualização concorrente em abas.
- Clique duplo em Publicar.
- Queda de rede após envio e interrupção/reinício do processo.
- Arquivo inválido, caminho externo e coleta redirecionada a endereço privado.
- Ordem das imagens e páginas do PDF.
- Execução manual pela CLI e restauração do backup.

## 9. Participação necessária do usuário

Revisar o plano, autorizar preparação das POCs, autenticar OpenAI via Sign in with ChatGPT com consentimento de uso da cota, autenticar LinkedIn e realizar os cliques de publicação de teste. API paga de imagens começa desativada. Nenhuma das ações operacionais desta seção foi executada neste registro.
