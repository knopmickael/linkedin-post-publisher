# Planejamento do LinkedIn Post Publisher

Registro inicial: 16/11/2026.

Este diretório registra a análise de `product.md` e o plano apresentado na conversa. As escolhas técnicas são **propostas**, não decisões aprovadas pelo usuário. Nenhuma integração foi comprovada pela simples consulta à documentação.

**Atualização de execução:** o usuário autorizou a implementação e retirou PDF do escopo. O estado atual e as instruções operacionais estão no [README do projeto](../README.md) e em [implementacao.md](implementacao.md). Os documentos de planejamento abaixo preservam o histórico; propostas sobre PDF estão suspensas e a proposta de Codex foi substituída.

## Documentos

- [Plano de implementação](plano-de-implementacao.md): arquitetura, fluxo editorial, persistência, telas, operação no Windows e etapas.
- [Registro de decisões propostas](decisoes-tecnicas.md): justificativas, pendências e regras do produto.
- [Provas de conceito e referências](provas-de-conceito.md): experimentos que condicionam a arquitetura, critérios de aceite e documentação oficial.
- [Revisão da integração OpenAI](revisao-integracao-openai.md): nova regra sem Codex local, autenticação OAuth e limitações da cota Plus por API.

## Situação atual

- O repositório continha apenas `product.md` antes deste registro.
- Node.js e npm foram encontrados no `PATH` da sessão consultada.
- O comando `codex` não foi encontrado no `PATH`; isso não comprova ausência de uma instalação em outro local.
- O Windows informou o fuso `E. South America Standard Time` (Brasília).
- Não foram instaladas dependências, executadas gerações, cadastradas tarefas, configuradas credenciais ou realizadas publicações.
- Os exemplos de comandos são especificações para implementação futura, não comandos já executados.

## Próxima decisão

Revisar este planejamento e autorizar a preparação das provas de conceito. A arquitetura das integrações será consolidada após os resultados. Autenticação OpenAI via OAuth e cliques de publicação real exigirão participação do usuário; a API paga de imagens começa desativada. A regra vigente proíbe Codex local; a consulta anterior ao PATH é apenas registro histórico.

O documento `product.md` continua sendo a referência dos requisitos. Divergências ou novas escolhas deverão ser registradas explicitamente nestes documentos.
