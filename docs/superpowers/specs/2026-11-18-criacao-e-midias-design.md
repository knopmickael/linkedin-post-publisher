# Criação de publicações e mídias

## Intenção e aprovação

Desenho aprovado na conversa em 18/11/2026: concentrar a criação em um modal com três opções, permitir escrita manual imediata, separar notícia de conteúdo informativo e aceitar GIFs e vídeos. Complemento do usuário: os assuntos predefinidos devem colocar notícias do mundo da tecnologia em primeiro lugar, com grande importância para vulnerabilidades novas.

## Abordagem

Reaproveitar o editor e o fluxo existente de revisão/aprovação/publicação, acrescentando modos explícitos de criação e tipos explícitos de mídia. É o caminho adotado na proposta aprovada: evita editores paralelos e permite os mesmos controles para os três modos. Alterar apenas o seletor de arquivos seria insuficiente, pois atualmente o servidor converte tudo em PNG e exige uma notícia para cada publicação.

## Experiência

O campo de assunto sai da página Publicações. Tanto **Gerar agora** quanto o botão de primeiro rascunho abrem um `<dialog>` acessível:

```text
Nova publicação                                  [Fechar]
Assunto da publicação
[Ex.: Kubernetes                                      ]
Usado pelas opções com IA. Até 500 caracteres.

[Gerar notícia (IA)]  [Manual]  [Dissertar (IA)]
```

- Notícia: assunto opcional; quando vazio, usa os assuntos predefinidos. Mantém notícias verificáveis dos últimos sete dias, deduplicação e fonte real no texto.
- Manual: cria e persiste imediatamente um rascunho vazio e abre o editor. Não exige assunto, credenciais, modelo nem uma execução de IA. O assunto, quando preenchido, pode servir como título inicial, mas não vira texto da publicação.
- Dissertar: assunto obrigatório, normalizado e limitado a 500 caracteres. Gera texto explicativo em pt-BR sobre conceitos, tópicos e aplicações do assunto, sem exigir RSS, notícia recente ou evento inédito. Não inventa experiências, links ou anúncios recentes.
- Os modos com IA retornam três sugestões de hashtags relevantes incorporadas ao corpo editável. A aplicação valida/normaliza as sugestões e respeita o limite final de 3.000 caracteres, incluindo hashtags e fonte.
- Falhas de criação aparecem no modal e preservam o assunto. Fechar/Escape restaura o foco no acionador. Tab permanece no modal. Durante uma geração de IA, Manual continua disponível.
- Rascunhos vazios podem ser salvos; aprovação exige texto não vazio. Publicação somente texto passa a ser um formato explícito.

## Prioridades editoriais e fontes

Sem assunto informado, priorizar **notícias atuais do mundo da tecnologia**, dando grande destaque a novas vulnerabilidades, falhas críticas, exploração confirmada e correções. Incluir software, hardware, sistemas operacionais, serviços, empresas e infraestrutura. IA, Cloud, System Design, arquitetura, performance e escalabilidade permanecem cobertos, sem exclusividade.

O texto sobre segurança deve separar divulgação de falha, exploração confirmada e disponibilidade de correção. CVE, gravidade, versões afetadas e mitigação só entram quando sustentados pela fonte consultada.

Acrescentar fontes em migração idempotente, sem desabilitar ou reconfigurar fontes existentes. Escolha técnica: CERT-EU e BleepingComputer com prioridade 5; Ars Technica com prioridade 4. Os endereços responderam com RSS nesta sessão:

- `https://cert.europa.eu/publications/security-advisories-rss`
- `https://www.bleepingcomputer.com/feed/`
- `https://feeds.arstechnica.com/arstechnica/index`

Edições posteriores do usuário são preservadas. A prioridade orienta a coleta e a seleção editorial; não dispensa relevância, recência nem verificação. Um assunto explícito continua substituindo o foco padrão.

## Mídias

Renomear **Imagens do post** para **Mídias do post**. Formatos: somente texto, imagem única, galeria de 2 a 20 imagens estáticas, GIF único e vídeo único. GIF e vídeo não se misturam com galerias nesta implementação; é uma escolha conservadora do implementador para o escopo de mídia única aprovado.

- JPG/PNG/WebP: conservar normalização em PNG, metadados removidos e limite local de 20 MiB.
- GIF: preservar animação e bytes, até 20 MiB como limite local, no máximo 250 quadros e menos de 36.152.320 pixels por quadro. Sem overlay nem geração/regeneração de arte sobre GIF.
- Vídeo: MP4 real com trilha de vídeo, duração entre 3 e 1.800 segundos e tamanho entre 75.000 e 500.000.000 bytes. Validar no servidor, independentemente da extensão/MIME enviados pelo navegador. Adotar 500 MB como limite conservador da seção de especificações da API, que também menciona um teto maior no campo de inicialização.
- Upload de vídeo deve ir para arquivo temporário em fluxo, sem buffer de 500 MB em memória. Limpar temporários em falhas e revalidar revisão antes de persistir.
- Imagens/GIFs têm descrição alternativa; vídeo tem controles de reprodução e descrição local, sem enviar campos de acessibilidade incompatíveis à API. Overlay segue exclusivo de imagem estática.
- Servir mídia com MIME correto; vídeo deve aceitar requisições HTTP Range para reprodução/seek. Prévia e cards diferenciam vídeo de imagem.
- Exportação ZIP preserva extensão e conteúdo corretos e usa arquivos em fluxo para vídeo.

## Persistência e integrações

SQLite: permitir publicação sem notícia nem tópico, manter título próprio e modo (`news`, `manual`, `informative`), ampliar formatos e registrar tipo/MIME/duração da mídia. Migrar registros existentes com seus IDs, revisões, aprovações, uploads, histórico e relacionamentos intactos. Não criar notícias ou URLs fictícias para manual/dissertação.

Geração de IA continua assíncrona, com lease e execução visível. Manual é uma criação síncrona local. A CLI atual permanece compatível; seu comando `generate` continua gerando notícia com os novos assuntos predefinidos.

LinkedIn: imagens/GIFs usam `/rest/images`; vídeo usa inicialização em `/rest/videos`, upload das partes informadas, coleta de ETags e finalização, seguido de publicação com URN de vídeo. Conteúdo somente texto omite `content`. Preservar revisão aprovada, hash do arquivo, uploads reaproveitáveis e tratamento de resultado incerto. Não repetir automaticamente a criação remota. Falha/processamento da mídia ocorre antes da fase de criação sempre que detectável.

## Verificação e limites

Cobrir migração com histórico, criação manual offline, dissertação sem RSS, prioridade de segurança, hashtags dentro do limite, animação preservada, MP4 inválido/duração/tamanho, Range, upload multipart remoto, reuso e resultado incerto. Validar modal e editor em desktop/mobile. Todas as integrações de teste são simuladas.

Não inclui geração de vídeo por IA, edição/transcodificação de vídeo, legendas/thumbnail customizados, agendamento, PDF ou publicação sem aprovação.

## Referências

- [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-10): JPG/GIF/PNG, limite de pixels e 250 quadros; `w_member_social` não garante GET de imagens.
- [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-10): MP4, limites de duração/tamanho, partes e finalização.
