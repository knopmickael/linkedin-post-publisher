Aplicação web local para Windows que pesquisa notícias de tecnologia, cria posts em português brasileiro por IA ou escrita manual, mantém histórico e publica no perfil pessoal do LinkedIn. Stack: Node.js com TypeScript, React e SQLite em arquivo. Escopo atualizado em 18/11/2026 conforme desenho aprovado em `docs/superpowers/specs/2026-11-18-criacao-e-midias-design.md`.

**1. Pesquisa e geração de texto**

- A criação é iniciada exclusivamente pelo usuário. **Gerar agora** abre modal com assunto e três opções: **Gerar notícia (IA)**, **Manual** e **Dissertar (IA)**. Manual cria rascunho vazio imediatamente, sem IA; Dissertar exige assunto e explica conceitos e aplicações, sem depender de notícia recente. A CLI continua gerando notícias. Não há geração automática por horário.
- Colete notícias dos últimos sete dias corridos. Use RSS, os feeds de novas publicações dos sites, e priorize blogs oficiais, documentação e notas de versão. Se o ambiente de geração tiver busca web, use-a para complementar a coleta e verificar a notícia na fonte original.
- Os temas predefinidos priorizam notícias atuais do mundo da tecnologia, com grande importância para novas vulnerabilidades, falhas críticas e correções. IA, Cloud, System Design, arquitetura, performance e escalabilidade continuam contemplados, sem exclusividade. Assunto explícito substitui o foco padrão naquela geração. Evite repetir pautas; sem notícia verificável adequada, registre **Sem pauta**. Fontes novas de segurança/tecnologia são adicionadas sem substituir configurações existentes.
- Gere um texto pronto para revisão com uma abertura direta, o que mudou, um efeito concreto para desenvolvedores e/ou investidores conforme a notícia e o link da fonte ao final. Use um tom técnico e natural, sem inventar experiências pessoais, números, citações ou previsões de retorno financeiro.
- Os dois modos com IA geram cerca de três hashtags relevantes incorporadas ao corpo editável. O limite final, incluindo fonte e hashtags, é 3.000 caracteres. Para segurança, não inventar CVEs, gravidade, versões afetadas nem confirmação de exploração.

**2. Uso do ChatGPT Plus — regra revisada em 16/11/2026**

- Não instalar nem executar Codex localmente. A integração deve ocorrer diretamente via SDK/API oficial da OpenAI, buscando usar a cota do meu plano ChatGPT Plus.
- Validar a elegibilidade do aplicativo local e da conta para **Sign in with ChatGPT com compartilhamento da cota**, usando OAuth. Essa modalidade fornece tokens de acesso, não uma API key convencional incluída no Plus. Uma API key da API Platform possui cobrança independente e não será adotada sem autorização explícita.
- Antes de consolidar a integração, fazer uma prova de conceito de autenticação, geração de texto em JSON e renovação da sessão em execução diária não interativa. O login e o consentimento iniciais podem exigir interação no navegador; a tarefa diária não deve exigi-la.
- Verificar texto e imagem separadamente. A documentação consultada em 16/11/2026 não suporta geração de imagem pela modalidade de compartilhamento da cota do ChatGPT. Nesse caso, permitir gerar a imagem no ChatGPT e importá-la pelo painel. Manter a API oficial de imagem como opção configurável, com cobrança separada e ativação explícita. Deixar o projeto utilizável quando o gerador estiver indisponível, a sessão expirar ou a cota acabar.

**3. Texto, imagens, GIFs e vídeos — escopo revisado**

- Permita **somente texto**, **imagem única**, **galeria com 2 a 20 imagens estáticas**, **GIF animado único** ou **vídeo MP4 único**. GIF: até 20 MiB locais, 250 quadros e menos de 36.152.320 pixels por quadro/canvas. MP4: 75.000 a 500.000.000 bytes e 3 segundos a 30 minutos, com trilha de vídeo. Validar no servidor e preservar animação. Imagem única é padrão para IA, somente texto para Manual. PDF permanece fora do escopo.
- Gere um conceito visual para a notícia. Na galeria, faça cada imagem cobrir um ponto diferente, mantendo consistência visual. Se houver títulos ou dados na arte, aplique-os na montagem final para que o texto fique legível e corresponda ao conteúdo aprovado.
- No painel, permita visualizar, reordenar, substituir, importar e regenerar imagens individualmente. Guarde os arquivos no disco e registre no SQLite o caminho, a ordem e o texto alternativo, uma descrição para leitores de tela.
- A seção **Mídias do post** exibe preview conforme tipo e vídeo com controles/Range. Overlay e regeneração de imagem são exclusivos de imagens estáticas. Vídeo usa upload remoto multipart e finalização antes da criação do post; ZIP preserva PNG/GIF/MP4. Não inclui geração/transcodificação de vídeo nem legendas customizadas.

**4. Painel e histórico**

- Liste os posts e permita abrir a fonte, editar o texto, trocar o formato, pré-visualizar as mídias e aprovar o conteúdo. Mostre os estados `rascunho`, `aprovado`, `publicando`, `publicado` e `falha`.
- Salve no SQLite o texto gerado e o editado, a URL original padronizada para deduplicação, a data da notícia, os arquivos associados, o histórico de execuções e o identificador devolvido pelo LinkedIn. Evite que solicitações manuais simultâneas gravem dois rascunhos para a mesma notícia.

**5. Publicação via código e OAuth**

- Implemente a integração em código TypeScript no servidor local. O usuário concede acesso pelo **OAuth 2.0**, o fluxo de autorização do LinkedIn, com a permissão `w_member_social` para publicar em seu nome. Use uma biblioteca mantida para OAuth ou o cliente HTTP do Node.js, conforme o que simplificar a implementação. A interface chama o servidor local, que guarda os segredos e tokens fora do navegador e do Git.
- Confirme na documentação vigente quais formatos e operações estão disponíveis para **perfil pessoal** com o acesso concedido ao aplicativo. Valide o envio das mídias e a criação do post para cada formato. Quando um formato não estiver disponível pela API com esse acesso, permita exportar o texto e os arquivos para publicação manual.
- A geração iniciada pelo usuário cria um rascunho. A publicação inicial acontece pelo botão **Publicar** após aprovação. Se houver falha de rede depois do envio, mostre que o resultado precisa ser verificado antes de tentar publicar de novo, para evitar duplicatas.

Entregue um plano com a arquitetura, o esquema do SQLite, as telas, os comandos de geração manual, a configuração do OAuth e as etapas de implementação. Comece pelas duas provas de conceito que determinam o restante do projeto: **integração direta SDK/API usando a cota Plus via OAuth, com validação independente das capacidades de texto e imagem**, e **publicação de mídia em perfil pessoal via API oficial do LinkedIn**. Para testar a integração, deixe o clique de publicação real sob meu controle.
