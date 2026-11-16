# Revisão da integração OpenAI — sem Codex local

Data: 16/11/2026. Origem: nova instrução do usuário após o planejamento inicial.

## Restrição confirmada

Não instalar nem executar Codex localmente. Integrar diretamente com OpenAI por SDK/API, com preferência pela cota do ChatGPT Plus. Não substituir o CLI por SDK que instale/inicie um runtime Codex ou app-server.

A CLI própria do produto permite geração manual: trata-se do código Node.js da aplicação, não do Codex.

## Distinção de autenticação

- **ChatGPT Plus não fornece uma API key convencional com consumo incluído na assinatura.** Chaves da API Platform têm faturamento separado.
- A documentação atual oferece **Sign in with ChatGPT com compartilhamento autorizado da cota** para aplicativos locais/open-source elegíveis. É OAuth, com consentimento específico para usar a cota; login por si só não basta.
- O access token OAuth pode ser enviado como Bearer ao endpoint público `https://api.openai.com/v1/responses`. Um parâmetro chamado `api_key` no SDK pode transportar esse token sem transformá-lo em uma API key convencional.
- Não copiar cookies, senhas, tokens de sessão do navegador ou credenciais de outro cliente. Usar o fluxo OAuth documentado da própria aplicação.
- A elegibilidade desta aplicação e conta ainda não foi testada. Não declarar que o Plus financiará a geração antes da POC.

## Integração proposta

1. Persistir um identificador opaco estável do host antes do primeiro login e os identificadores de registro previstos pelo fluxo oficial.
2. Implementar login no navegador com callback loopback, PKCE, `state` e `nonce`, validação OIDC e consentimento de compartilhamento da cota.
3. Proteger tokens OAuth e renovação com armazenamento Windows no escopo do usuário.
4. Consultar modelos disponíveis para a conta; não presumir catálogo fixo.
5. Usar SDK oficial OpenAI para TypeScript ou cliente HTTP Node.js para Responses, conforme compatibilidade comprovada na POC.
6. Renovar tokens pelo fluxo documentado e testar acesso pela CLI manual com painel fechado.
7. Tratar expiração, revogação, cota e indisponibilidade sem migrar automaticamente para cobrança de API.

## Restrições atuais da modalidade

Conforme documentação de preview consultada:

- HTTP Responses exige `store: false`, `stream: true` e `input` como array.
- Processar eventos até `response.completed`; um stream iniciado ou texto parcial não prova sucesso.
- Tratar `response.failed`, `response.incomplete`, interrupção e erros de limite após início do stream.
- Não usar parâmetros não suportados, como `background`, `temperature`, `max_output_tokens`, `previous_response_id` por HTTP e outros listados na documentação.
- Validar suporte a saída JSON estruturada na POC; não presumir que todos os recursos da API convencional estejam habilitados nesse fluxo.
- **Geração de imagens não é suportada.** Imagem como entrada não equivale a geração de imagem.
- Busca web depende do modelo e das políticas da conta/workspace; RSS continua sendo a base.

## Consequências para o produto

- Texto: provar geração direta via API com cota Plus e OAuth.
- Imagem: importação manual do ChatGPT como caminho inicial compatível com essa restrição. Testar leitura, validação e persistência do arquivo importado.
- API paga de imagem: permanece opcional e desativada, conforme requisito anterior. Sua ativação requer autorização explícita.
- Se a conta/aplicação não for elegível, registrar o impedimento e consultar o usuário; não adotar chave de API paga silenciosamente.
- As POCs LinkedIn, aprovação humana, SQLite e painel continuam previstas. A geração é exclusivamente manual.

## Histórico

O plano inicial propunha Codex CLI como provedor. Essa proposta foi substituída pela nova regra. Referências ao Codex na observação inicial do ambiente são históricas, não requisitos vigentes.

## Referências oficiais consultadas

- [ChatGPT Plus: API separada e ferramentas participantes](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)
- [ChatGPT plan usage para aplicações locais/open-source](https://developers.openai.com/siwc/token-sharing-open-source)
- [Modelos e inferência pelo endpoint público](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Limitações do preview, inclusive imagens](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Créditos de API por assinatura: benefício listado para Pro/Business, não Plus](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)
