Atue em modo de planejamento. Proponha uma aplicação web local para Windows que pesquise notícias de tecnologia, gere posts em português brasileiro com imagens, mantenha um histórico e publique no meu perfil pessoal do LinkedIn. Quero usar Node.js com TypeScript e SQLite, um banco armazenado em arquivo. Apresente o plano e as decisões técnicas antes de implementar.

**1. Pesquisa e geração de texto**

- A geração é iniciada exclusivamente pelo usuário, pelo botão **Gerar agora** ou pela CLI. Não há geração automática por horário.
- Colete notícias dos últimos sete dias corridos. Use RSS, os feeds de novas publicações dos sites, e priorize blogs oficiais, documentação e notas de versão. Se o ambiente de geração tiver busca web, use-a para complementar a coleta e verificar a notícia na fonte original.
- Priorize Java, Spring Boot, AWS, Kubernetes, arquitetura de software e ferramentas de desenvolvimento. Escolha uma notícia com impacto prático. Evite repetir a mesma pauta, mesmo quando sites diferentes cobrirem o assunto. Se faltar uma notícia verificável, registre a execução sem gerar post.
- Gere um texto pronto para revisão com uma abertura direta, o que mudou, um efeito concreto para quem desenvolve ou opera software e o link da fonte ao final. Use um tom técnico e natural, sem inventar experiências pessoais, números ou citações.

**2. Uso do ChatGPT Plus — regra revisada em 16/11/2026**

- Não instalar nem executar Codex localmente. A integração deve ocorrer diretamente via SDK/API oficial da OpenAI, buscando usar a cota do meu plano ChatGPT Plus.
- Validar a elegibilidade do aplicativo local e da conta para **Sign in with ChatGPT com compartilhamento da cota**, usando OAuth. Essa modalidade fornece tokens de acesso, não uma API key convencional incluída no Plus. Uma API key da API Platform possui cobrança independente e não será adotada sem autorização explícita.
- Antes de consolidar a integração, fazer uma prova de conceito de autenticação, geração de texto em JSON e renovação da sessão em execução diária não interativa. O login e o consentimento iniciais podem exigir interação no navegador; a tarefa diária não deve exigi-la.
- Verificar texto e imagem separadamente. A documentação consultada em 16/11/2026 não suporta geração de imagem pela modalidade de compartilhamento da cota do ChatGPT. Nesse caso, permitir gerar a imagem no ChatGPT e importá-la pelo painel. Manter a API oficial de imagem como opção configurável, com cobrança separada e ativação explícita. Deixar o projeto utilizável quando o gerador estiver indisponível, a sessão expirar ou a cota acabar.

**3. Imagem única ou galeria — escopo revisado**

- Permita escolher entre **imagem única** e **galeria com várias imagens** (2 a 20). PDF e carrossel de documentos estão fora do escopo atual: não oferecer upload, montagem ou publicação de PDF. A quantidade de imagens deve ser configurável por publicação, dentro dos limites documentados do LinkedIn. Use imagem única como padrão.
- Gere um conceito visual para a notícia. Na galeria, faça cada imagem cobrir um ponto diferente, mantendo consistência visual. Se houver títulos ou dados na arte, aplique-os na montagem final para que o texto fique legível e corresponda ao conteúdo aprovado.
- No painel, permita visualizar, reordenar, substituir, importar e regenerar imagens individualmente. Guarde os arquivos no disco e registre no SQLite o caminho, a ordem e o texto alternativo, uma descrição para leitores de tela.

**4. Painel e histórico**

- Liste os posts e permita abrir a fonte, editar o texto, trocar o formato, pré-visualizar as mídias e aprovar o conteúdo. Mostre os estados `rascunho`, `aprovado`, `publicando`, `publicado` e `falha`.
- Salve no SQLite o texto gerado e o editado, a URL original padronizada para deduplicação, a data da notícia, os arquivos associados, o histórico de execuções e o identificador devolvido pelo LinkedIn. Evite que solicitações manuais simultâneas gravem dois rascunhos para a mesma notícia.

**5. Publicação via código e OAuth**

- Implemente a integração em código TypeScript no servidor local. O usuário concede acesso pelo **OAuth 2.0**, o fluxo de autorização do LinkedIn, com a permissão `w_member_social` para publicar em seu nome. Use uma biblioteca mantida para OAuth ou o cliente HTTP do Node.js, conforme o que simplificar a implementação. A interface chama o servidor local, que guarda os segredos e tokens fora do navegador e do Git.
- Confirme na documentação vigente quais formatos e operações estão disponíveis para **perfil pessoal** com o acesso concedido ao aplicativo. Valide o envio das mídias e a criação do post para cada formato. Quando um formato não estiver disponível pela API com esse acesso, permita exportar o texto e os arquivos para publicação manual.
- A geração iniciada pelo usuário cria um rascunho. A publicação inicial acontece pelo botão **Publicar** após aprovação. Se houver falha de rede depois do envio, mostre que o resultado precisa ser verificado antes de tentar publicar de novo, para evitar duplicatas.

Entregue um plano com a arquitetura, o esquema do SQLite, as telas, os comandos de geração manual, a configuração do OAuth e as etapas de implementação. Comece pelas duas provas de conceito que determinam o restante do projeto: **integração direta SDK/API usando a cota Plus via OAuth, com validação independente das capacidades de texto e imagem**, e **publicação de mídia em perfil pessoal via API oficial do LinkedIn**. Para testar a integração, deixe o clique de publicação real sob meu controle.
