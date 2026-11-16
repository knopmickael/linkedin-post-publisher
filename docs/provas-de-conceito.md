# Provas de conceito e documentação

Data da consulta: 16/11/2026. Estado: **planejadas; não executadas**.

**Revisão de escopo:** a implementação foi autorizada; a prova real de conta ainda depende de login do usuário. PDF foi suspenso: os testes reais LinkedIn devem cobrir somente imagem única e galeria. Referências anteriores a documento PDF abaixo ficam como histórico técnico, sem recurso correspondente na aplicação.

## POC 1 — SDK/API OpenAI com cota ChatGPT Plus via OAuth

### Objetivo

Validar autenticação OAuth com compartilhamento da cota, texto estruturado e renovação em geração iniciada pelo usuário. Não instalar ou executar Codex. A imagem será importada manualmente: geração de imagem não é suportada pela modalidade atual. Ver [revisão de requisitos](revisao-integracao-openai.md).

### Preparação

1. Confirmar elegibilidade da conta e do aplicativo local para Sign in with ChatGPT e compartilhamento da cota.
2. Preparar registro e identificador persistente do host conforme documentação oficial.
3. Implementar login OAuth com consentimento, PKCE, state, nonce e validação OIDC.
4. Proteger tokens no Windows; nenhuma credencial é exposta no frontend ou nos logs.
5. Usar SDK oficial OpenAI para TypeScript ou HTTP direto, sem CLI/runtime Codex.
6. Definir timeout, modelos disponíveis e diagnóstico; não selecionar API key paga herdada do ambiente.

### Teste A — Texto

Entrada: pequeno conjunto de fontes verificadas, com título, URL, data, identificação da fonte e conteúdo/trechos relevantes.

Saída editorial proposta, validada por JSON Schema:

```json
{
  "sourceUrl": "...",
  "newsDate": "...",
  "topicKey": "...",
  "text": "...",
  "visualConcept": "...",
  "slides": [
    {
      "purpose": "...",
      "imagePrompt": "...",
      "overlayText": "...",
      "altText": "..."
    }
  ]
}
```

Usar `POST https://api.openai.com/v1/responses` com access token OAuth como Bearer, `store: false`, `stream: true` e `input` em array. Confirmar suporte ao JSON Schema nesse fluxo e modelo; validar sempre o resultado na aplicação. Não usar parâmetros rejeitados pela modalidade. Consumir o stream até `response.completed`; texto parcial ou stream interrompido não é sucesso.

Aceite:

- Login e consentimento iniciais concluídos pelo navegador; nenhuma solicitação de entrada durante a geração diária.
- JSON válido e aprovado pela validação da aplicação.
- Texto em português brasileiro, fiel e rastreável às fontes.
- Sessão expirada, cota esgotada, timeout e saída inválida distinguíveis.
- Renovação OAuth pelo fluxo documentado e repetição bem-sucedida pela CLI manual, com painel fechado.
- Erros de compartilhamento de cota, inclusive após início do stream, não disparam cobrança de API independente.

### Teste B — Importação de imagem e limitação de geração

A documentação atual de compartilhamento da cota via API exclui geração de imagens. Registrar essa capacidade como não suportada nessa modalidade. O usuário gera a imagem no ChatGPT e importa o arquivo; a aplicação valida e salva no diretório permitido. Uma eventual POC da API paga de imagens é separada e exige autorização explícita.

Aceite:

- Arquivo existe fisicamente: caminho informado pelo modelo não basta.
- Caminho resolvido permanece dentro do diretório permitido.
- Aplicação lê e decodifica os bytes.
- Formato, tamanho e dimensões são válidos.
- Arquivo importado permanece acessível ao usuário da aplicação e vinculado ao post.
- Importação não faz chamada paga de geração.

### Resultado e consequência

| Resultado | Consequência proposta |
| --- | --- |
| OAuth/cota e texto aprovados | SDK/API com cota Plus para texto; imagem importada manualmente |
| Conta/aplicativo não elegível ou gerador indisponível | Registrar bloqueio; preservar histórico, edição, importação e exportação; consultar usuário antes de mudar cobrança |
| API oficial de imagem ativada explicitamente | Provedor opcional com cobrança separada |

Registrar versão do SDK, contexto do usuário, modelo, parâmetros sem segredos, duração, artefatos, erros e resultado de cada teste. Não copiar tokens para documentação.

## POC 2 — LinkedIn em perfil pessoal

### Preparação OAuth

1. Criar/configurar aplicativo no Developer Portal e atender aos requisitos do portal, inclusive eventual associação/verificação de uma Page.
2. Habilitar Share on LinkedIn: `w_member_social`.
3. Habilitar Sign In with LinkedIn using OpenID Connect: `openid profile`.
4. Cadastrar exatamente a URL de callback; validar proposta `https://localhost:4317/auth/linkedin/callback` e certificado local confiável. Não presumir que o portal aceitará a configuração.
5. Usar Authorization Code Flow; troca de código apenas no servidor.
6. Validar `state` de uso único, identidade OIDC e expiração.
7. Confirmar identidade do autor e URN pessoal correspondente; não usar autor de organização por copiar exemplos da documentação.
8. Guardar segredos protegidos pelo Windows, fora do navegador e do Git.

O aplicativo deverá oferecer reconexão. Refresh programático só será implementado se o acesso real disponibilizar esse recurso; a documentação restringe refresh tokens a determinados parceiros.

### Matriz de validação

| Formato | Upload / criação | Limites consultados |
| --- | --- | --- |
| Imagem única | Images API + Posts API | Uma imagem; JPG, PNG ou GIF; menos de 36.152.320 pixels |
| Galeria | Images API + MultiImage na Posts API | De 2 a 20 imagens; mesmos formatos/pixels |
| PDF paginado | Documents API + Posts API | Até 100 MB e 300 páginas |

O produto poderá impor limites internos menores para custo/desempenho, desde que sejam explícitos e não confundidos com limites oficiais. Para GIF, a documentação consultada limita a 250 quadros; o fluxo inicial prioriza imagens estáticas.

O PDF será publicado como documento; o tipo Carousel da API é voltado a anúncios, não a carrossel orgânico.

### Procedimento por formato

1. Preparar uma imagem, duas imagens e um PDF curto, respectivamente.
2. Inicializar upload com proprietário pessoal e enviar bytes ao endereço devolvido.
3. Registrar URN e evidências do upload; validar processamento na medida das permissões concedidas.
4. Preparar payload em `/rest/posts`, com versão explícita e protocolo Rest.li exigido.
5. Mostrar revisão e botão de publicação em interface mínima.
6. **Somente o clique do usuário realiza a publicação real. Não automatizar esse clique nos testes.**
7. Verificar HTTP de criação, `x-restli-id` e resultado visual no LinkedIn.
8. Registrar capacidade como não testada, validada ou indisponível, com conta, versão, data e evidências sem segredos.

Preferir APIs `/rest/images`, `/rest/documents` e `/rest/posts`. Os exemplos antigos de `ugcPosts` não serão a base principal.

### Limitações que precisam de teste

- `w_member_social` não implica permissão de leitura de posts; `r_member_social` é restrita.
- A documentação de Images API informa restrição de GET com token somente `w_member_social` em chamadas versionadas. Não projetar polling obrigatório sem confirmar acesso.
- Validar prontidão de imagens/documentos e criação do post sem supor que upload bem-sucedido significa processamento concluído.
- Não assumir renovação automática do token nem disponibilidade de todos os endpoints apenas pela existência do scope.
- A API de criação publica de fato; não confundir aprovação local com um rascunho remoto no LinkedIn.

Se um formato não funcionar com o acesso concedido, manter sua edição e exportação manual. Resultado incerto após envio bloqueia repetição automática e exige conferência do usuário.

## Referências oficiais consultadas

As páginas podem mudar; revalidar antes da implementação e registrar a versão da API usada nos testes.

- [ChatGPT Plus e distinção da API](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)
- [Sign in with ChatGPT e compartilhamento da cota](https://developers.openai.com/siwc/token-sharing-open-source)
- [Modelos e inferência](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Limitações, incluindo geração de imagens](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [LinkedIn — Share on LinkedIn (inclui exemplos antigos)](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [LinkedIn — Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-10)
- [LinkedIn — Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-10)
- [LinkedIn — MultiImage API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api?view=li-lms-2026-10)
- [LinkedIn — Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2026-10)
- [LinkedIn — Authorization Code Flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [LinkedIn — OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
