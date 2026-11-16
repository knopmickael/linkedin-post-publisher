# Registro de decisões técnicas propostas

Data: 16/11/2026. Estado geral: **aguardando revisão do usuário**.

Este registro preserva as recomendações feitas na análise. “Proposta” não significa aprovação, implementação ou capacidade comprovada da conta.

**Revisão de requisitos:** o usuário determinou integração direta SDK/API sem Codex local. Essa restrição está confirmada; o restante da stack continua proposto. Detalhes e evidências em [revisao-integracao-openai.md](revisao-integracao-openai.md).

**Autorização posterior:** implementação autorizada até o final, com **imagem única ou galeria**. PDF suspenso. Decisões efetivamente aplicadas e verificações: [implementacao.md](implementacao.md).

| ID | Proposta | Justificativa / condição |
| --- | --- | --- |
| D01 | Aplicação local Windows, de um único usuário | Escopo de `product.md`; publicação em perfil pessoal |
| D02 | Monólito modular em Node.js LTS suportado e TypeScript estrito | Compartilhar regras entre servidor e CLI sem infraestrutura adicional |
| D03 | Fastify no backend; React + Vite no painel | API local e editor interativo; frontend compilado servido na mesma origem |
| D04 | SQLite com `better-sqlite3` e migrações versionadas | Banco em arquivo e transações explícitas; validar compatibilidade com a versão fixada do Node no Windows |
| D05 | Zod para validação na aplicação e JSON Schema na geração | Validar contratos externos e entradas no servidor |
| D06 | `rss-parser`, Readability e parser HTML | Coleta de feeds e extração de conteúdo; feeds concretos ainda precisam ser verificados |
| D07 | Sharp + templates SVG para montagem de imagens | Texto legível e montagem determinística; PDF e `pdf-lib` retirados do escopo |
| D08 | Biblioteca OAuth/OIDC mantida, como `openid-client` | Evitar implementação manual de validação OIDC; biblioteca/versão finais serão confirmadas na POC |
| D09 | Vitest e Playwright nos fluxos relevantes | Testar regras críticas, concorrência e revisão/publicação |
| D10 | Executar primeiro as POCs OpenAI SDK/API e LinkedIn | As capacidades da conta e do aplicativo condicionam as integrações |
| D11 | Substituída: integração direta SDK/API com OAuth Sign in with ChatGPT, sem Codex local | Nova regra do usuário; elegibilidade, JSON e renovação sem interação dependem da POC |
| D12 | API oficial de imagem opcional, desativada por padrão | Cobrança separada e ativação explícita; nunca trocar silenciosamente para serviço pago |
| D13 | Importação manual de imagens como alternativa permanente | Manter o produto utilizável sem geração automática |
| D14 | CLI e botão chamam o mesmo serviço de geração manual | A CLI independe do painel e do servidor HTTP |
| D15 | Geração exclusivamente por iniciativa do usuário | O usuário decide quando criar cada rascunho |
| D16 | Recuperar uma execução diária perdida quando possível, sem acumular dias | Política recomendada, ainda sujeita à confirmação; não prometer execução com computador desligado |
| D17 | Janela móvel dos últimos sete dias, referenciada em `America/Sao_Paulo` | Interpretação proposta de “sete dias corridos”; confirmar se o usuário prefere dias civis |
| D18 | RSS como base; busca web complementar quando disponível | A execução não depende de disponibilidade de busca; verificar sempre a fonte original |
| D19 | Priorizar fontes primárias e impacto técnico ou de mercado | Temas: AI em toda a sua abrangência relevante para desenvolvedores e/ou investidores, Cloud, System Design, arquitetura de software, performance e escalabilidade. Cobertura jornalística complementa o contexto de empresas e mercado |
| D20 | Sem notícia verificável, registrar execução sem criar post | Evitar geração artificial ou factualidade insuficiente |
| D21 | Deduplicar URL, evento e similaridade editorial | Evitar repetir uma pauta coberta por veículos diferentes |
| D22 | Um post por pauta no escopo inicial | Restrição persistida; eventual reutilização editorial exigirá decisão futura |
| D23 | Trava de geração com prazo, renovação e restrições únicas no banco | Evitar duplicação por concorrência e recuperar processo interrompido |
| D24 | Imagem única como padrão; galeria de 2 a 20 imagens | Os dois formatos compõem o escopo implementado |
| D25 | Galeria como MultiImage | PDF suspenso por determinação do usuário; sem upload ou publicação de documentos |
| D26 | Preferir `/rest/images` e `/rest/posts` | APIs atuais com versão explícita; não basear o projeto novo nos exemplos antigos de UGC |
| D27 | Capacidade por formato: não testado, validado ou indisponível | Registrar conta, versão e evidência; documentação não garante acesso efetivo |
| D28 | Exportar texto e arquivos quando publicação via API não estiver disponível | Preservar o uso manual para todos os formatos |
| D29 | Aprovação vinculada à revisão exata do conteúdo | Alteração de texto, formato ou mídia invalida aprovação |
| D30 | Publicar somente por clique, após aprovação | A geração manual apenas cria rascunhos; também vale para as POCs |
| D31 | Congelar revisão durante envio | Publicar exatamente o conteúdo aprovado e prevenir edição concorrente |
| D32 | Resultado desconhecido bloqueia nova tentativa automática | Timeout após envio pode significar publicação concluída; conferir no LinkedIn antes de repetir |
| D33 | Não presumir reconciliação por leitura nem refresh token | `w_member_social` não garante leitura; refresh programático depende do aplicativo |
| D34 | Dados em `%LOCALAPPDATA%\LinkedInPostPublisher` | Separar dados persistentes de código/build; caminhos de mídia relativos no banco |
| D35 | Segredos protegidos pelo Windows no escopo do usuário | DPAPI ou mecanismo equivalente; SQLite contém referência, não token em texto aberto |
| D36 | Fontes e conteúdo coletado não recebem confiança operacional | Prompt trata notícias como dados; processo gerador não recebe segredos do LinkedIn |
| D37 | Servidor limitado a loopback e operações protegidas | Validar Host, origem, sessão local e CSRF; CORS não substitui autenticação |
| D38 | Backups consistentes de SQLite e mídias | Usar procedimento apropriado para banco com WAL; testar restauração |
| D39 | Não instalar nem executar Codex CLI, app-server ou runtime Codex via SDK | Restrição confirmada pelo usuário; a CLI própria da aplicação continua prevista |
| D40 | Distinguir token OAuth da cota ChatGPT de API key da API Platform | Plus não inclui API key convencional com saldo de API; cobrança separada não autorizada |
| D41 | Imagem manual no fluxo Plus por API enquanto a modalidade não suportar geração | Limitação documentada; API paga de imagens continua opcional e desativada |
| D42 | SDK oficial OpenAI para TypeScript, ou HTTP direto se necessário ao fluxo documentado | Proposta; usar endpoint público Responses, sem endpoints internos do ChatGPT |
| D43 | Suspender PDF em toda a aplicação | Regra confirmada pelo usuário antes da implementação; somente posts com uma ou mais imagens |

## Regras editoriais preservadas

- Texto em português brasileiro: abertura direta, o que mudou, efeito concreto para desenvolvimento/operação e link original ao final.
- Tom técnico e natural; não inventar experiências pessoais, números ou citações.
- Conceito visual comum para a publicação; cada imagem/página deve cobrir um ponto diferente.
- Aplicar títulos e dados na montagem final usando o conteúdo aprovado.
- Preservar originais; regenerações geram novas versões.
- Armazenar ordem, caminho, hash e descrição alternativa de cada mídia.
- Limites por formato são validados no backend, conforme versão da API e capacidade testada.

## Controles de segurança previstos

- Tokens, client secret, códigos OAuth e URLs assinadas de upload não aparecem em logs, Git ou bundle do frontend.
- Validar `state`, identidade OIDC, assinatura, emissor, audiência e expiração com biblioteca mantida.
- Uploads limitados por conteúdo, tamanho e dimensões; nomes internos gerados pela aplicação.
- Servir arquivos por identificador, sem aceitar caminhos arbitrários do navegador.
- Coleta HTTP com timeout, limites e bloqueio de destinos privados indevidos, inclusive em redirecionamentos.
- SQL parametrizado; dados externos validados e saída codificada no contexto correto.
- Invocar executáveis por argumentos estruturados, evitando interpolar notícias em comandos de shell.

## Questões que permanecem abertas

1. Versões exatas do runtime e bibliotecas, inclusive SDK OpenAI.
2. Elegibilidade do aplicativo/conta para uso da cota via OAuth, JSON e renovação na geração manual. Geração de imagem não é suportada nessa modalidade na documentação consultada.
3. Acesso efetivo do aplicativo aos três formatos e operações auxiliares.
4. Aceitação do callback HTTPS local e provisionamento do certificado confiável.
5. Procedimento de prontidão de mídia quando a leitura do status não é permitida.
6. Confirmação da janela móvel e da política de recuperação de horário perdido.
7. Lista final de feeds, parâmetros editoriais e direção visual.
8. Mecanismo concreto de armazenamento protegido e comportamento sob logon em segundo plano.
