# Publica · LinkedIn Post Publisher

Aplicação local para Windows: pesquisa RSS, rascunhos técnicos em português, revisão de texto e imagens e publicação no **perfil pessoal** do LinkedIn. Imagem única ou galeria de 2 a 20 imagens. **Sem PDF e sem Codex local.**

## Requisitos

- Node.js **22.12 ou superior**, npm e Windows com PowerShell para proteção DPAPI.
- Conta ChatGPT elegível para Sign in with ChatGPT **com autorização de compartilhamento da cota**. Essa elegibilidade precisa ser confirmada no login real.
- Aplicativo no LinkedIn Developer Portal com Share on LinkedIn e Sign In with LinkedIn using OpenID Connect.
- Internet para coleta e integrações. Banco e arquivos permanecem locais.

## Iniciar

Na pasta do projeto:

```powershell
npm ci
npm run build
npm start
```

Abra **http://127.0.0.1:4317**. Use sempre a origem configurada, incluindo esquema, host e porta. Os comandos acima não instalam Codex nem publicam conteúdo.

O diretório padrão de dados é `%LOCALAPPDATA%\LinkedInPostPublisher`. Para alterar, configure `APP_DATA_DIR` antes de iniciar o processo. As variáveis de `.env.example` são exemplos: não há carregamento automático de `.env`; use variáveis de ambiente do Windows ou do terminal.

```powershell
$env:APP_DATA_DIR = 'C:\dados\LinkedInPostPublisher'
npm start
```

### Desenvolvimento

`npm run dev` reinicia o backend TypeScript. Depois de modificar o frontend, execute `npm run build` para servir o bundle atualizado. O servidor Vite opcional (`npm run dev:web`) é útil para desenvolvimento visual, mas ações mutáveis exigem a origem oficial configurada; para validar o fluxo completo use o painel servido pelo backend.

## Configurar o ChatGPT

1. Abra **Configurações → Continue with ChatGPT**.
2. Faça login e autorize explicitamente o compartilhamento da cota.
3. O callback OpenAI usa `http://127.0.0.1:1455/auth/openai/callback`; a porta 1455 deve estar disponível.
4. Atualize os modelos disponíveis, selecione um e clique em **Salvar configurações**.
5. Use **Gerar agora** para confirmar a integração real.

O fluxo implementa registro dinâmico oficial, host ID persistente, PKCE, state, nonce, validação da assinatura do ID token e renovação serializada do refresh token. Requer execução pelo mesmo usuário do Windows. Se a conta não for elegível, não há mudança automática para API paga.

**Plus não inclui uma API key convencional.** O SDK recebe um token OAuth para Responses com `store:false` e `stream:true`. A geração só termina quando chega `response.completed` e o JSON editorial é validado.

### Imagens

A modalidade atual de compartilhamento da cota não suporta geração de imagens. O rascunho oferece conceitos/prompts para copiar e usar no ChatGPT. Baixe as imagens e importe no painel. O editor aceita JPG, PNG e WebP estáticos, até 20 MB por arquivo; converte para PNG, ajusta dimensões e remove metadados.

Importe a quantidade configurada no post, preencha as descrições alternativas e, se desejar, aplique um título curto na montagem final. Salve cada alteração de imagem. Há ações de ordenação, remoção e prompt para substituição. PDF não é aceito nem gerado.

Opcional: em Configurações, habilite **API paga de imagens**, informe uma chave da API Platform e salve. Esse caminho tem cobrança independente; cada geração/regeneração exige confirmação. O padrão é desativado, sem fallback de cobrança.

## Configurar o LinkedIn

1. Crie o aplicativo no [Developer Portal](https://www.linkedin.com/developers/apps); cumpra os requisitos de associação/verificação apresentados pelo portal.
2. Habilite os produtos **Share on LinkedIn** e **Sign In with LinkedIn using OpenID Connect**.
3. Confira os scopes `openid profile w_member_social`.
4. Cadastre a URL de callback exibida pelo painel, exatamente como apresentada.
5. Preencha Client ID e Client Secret no painel. O botão **Salvar e conectar LinkedIn** é habilitado quando os dois campos estiverem completos.
6. Clique nesse botão: ele protege as credenciais com DPAPI e abre a autorização. Se elas já estiverem salvas, use **Conectar LinkedIn**. O botão geral de configurações não é necessário para iniciar esse fluxo.

Os cartões das integrações exibem **Conectado** ou **Não conectado**. Os estados **Rascunho/Aprovado** pertencem às publicações.

### HTTPS local, quando exigido pelo portal

A documentação do LinkedIn orienta callback HTTPS. Se o portal não aceitar o callback HTTP local, use um certificado local confiável (por exemplo, emitido com uma ferramenta de certificados de desenvolvimento) contendo **localhost e 127.0.0.1**. Configure antes de iniciar:

```powershell
$env:APP_ORIGIN = 'https://localhost:4317'
$env:TLS_CERT_PATH = 'C:\certificados\localhost.pem'
$env:TLS_KEY_PATH = 'C:\certificados\localhost-key.pem'
npm start
```

Abra `https://localhost:4317` e cadastre `https://localhost:4317/auth/linkedin/callback` no portal. A chave TLS fica fora do Git. O callback OpenAI continua sendo o listener HTTP loopback separado.

### Publicar e validar os formatos

1. Abra o rascunho, revise fonte/texto e importe as imagens.
2. Escolha imagem única (1) ou galeria (2 a 20), defina a quantidade e salve.
3. Salve descrições/títulos das imagens. Confira a prévia aproximada.
4. Clique **Aprovar revisão**.
5. Clique **Publicar no LinkedIn** e confirme. Este é o único caminho de criação de posts remotos.

A aplicação inicializa uploads em `/rest/images`, envia os bytes e cria um post em `/rest/posts` com autor pessoal. Registra a URN retornada e marca o formato como validado somente após sucesso real. A versão da API é configurável; padrão inicial `202610`.

`w_member_social` pode não permitir GET de status da imagem; o fluxo não exige polling proibido. Se a criação for recusada porque a imagem ainda está processando, aguarde, aprove novamente e tente pelo botão: uploads confirmados da mesma revisão são reaproveitados. Permissões/formatos não autorizados aparecem como erro; use **Exportar texto e imagens (.zip)** para publicação manual.

**Resultado incerto:** timeout, erro de servidor ou interrupção após início da criação bloqueiam novo envio. Confira o perfil, depois registre no painel a URL do post encontrado ou confirme sua ausência. Não há retry automático de criação. Uma edição invalida a aprovação. Posts publicados não são editados remotamente por este produto.

## Geração manual

Você decide quando gerar cada rascunho: use **Gerar agora** no painel ou o comando `generate` da CLI. Não há geração automática por horário. No painel, a geração começa com imagem única; escolha formato e quantidade de imagens na seção **Imagens do post** do editor. Na CLI, também é possível usar `--count`. O histórico editorial fica no SQLite.

Para remover um post ainda em **Rascunho**, use a lixeira no canto superior direito do card em Publicações e confirme no modal. A listagem e os contadores são atualizados após a exclusão. A execução de geração permanece no histórico, sem link para o rascunho removido.

### Foco de pesquisa

- **AI / inteligência artificial:** novos modelos, empresas, lançamentos, ferramentas, agentes, pesquisa, chips, infraestrutura, custos, adoção, parcerias, aquisições, investimentos e novidades relevantes para desenvolvedores e/ou investidores.
- **Cloud, System Design, arquitetura de software, performance e escalabilidade.**

A seleção exige uma notícia verificável dos últimos sete dias com impacto técnico ou de mercado dentro desses temas. Fontes primárias têm preferência para anúncios e dados; cobertura jornalística complementa o contexto de empresas e mercado.

Os feeds iniciais incluem OpenAI, Google DeepMind, Hugging Face, NVIDIA, TechCrunch AI, AWS, Google Cloud, AWS Architecture, Cloudflare e Netflix Engineering. A coleta consulta até três artigos recentes por feed e percorre todas as fontes habilitadas para dar espaço aos diferentes temas.

Na primeira inicialização após esta atualização, uma migração desabilita os feeds anteriores e ativa o novo conjunto, substituindo completamente o foco antigo. Os registros dos feeds e o histórico de posts são preservados. Alterações posteriores nos feeds continuam sob controle do usuário em Configurações; a migração não é reaplicada.

## CLI e backup

```powershell
node dist/cli.js generate --count 3
node dist/cli.js status
node dist/cli.js backup
```

O backup cria uma pasta datada em `backups/`, com snapshot consistente do SQLite, mídias e manifesto. Arquivos antigos são preservados para revisões. Backups contêm dados e credenciais cifradas: proteja-os.

Para restaurar, pare o servidor e use **um destino novo**, sem banco existente:

```powershell
node dist/cli.js restore --from 'C:\backup\pasta-datada' --data-dir 'C:\dados\PublicaRestaurado'
```

Depois configure `APP_DATA_DIR` para esse destino. DPAPI exige o mesmo usuário/perfil Windows; em outra máquina, reconecte as integrações. O comando recusa sobrescrever banco existente e verifica integridade.

## Verificação

```powershell
npm run check
npm test
npm run build
npm run test:browser
```

Os testes de publicação usam respostas simuladas e nunca publicam no LinkedIn. Os testes de navegador usam dados isolados e não autenticam em contas externas. Para executar o navegador pela primeira vez: `npx playwright install chromium`.

As integrações reais dependem do seu login, permissões e clique. A implementação não equivale a uma POC de conta concluída. Veja [docs/implementacao.md](docs/implementacao.md).

## Segurança e limites do escopo

- Serviço vinculado a loopback; não expor a porta à rede.
- Sessão local HttpOnly/SameSite, token CSRF, origem e Host verificados.
- URLs RSS/artigos com proteção de DNS/IP contra destinos privados e limite de leitura.
- Tokens OpenAI/LinkedIn separados, cifrados no SQLite via Windows DPAPI CurrentUser.
- Sem senha ChatGPT, cookies extraídos ou endpoints internos.
- Concorrência protegida por leases, revisão otimista e restrições SQLite.
- Modelo sugere pauta/fatos; revisão humana e conferência da fonte continuam fazendo parte do fluxo.
- Sem pesquisa web paga automática, publicação agendada, PDF ou gestão de organizações.

Fora do Windows, desenvolvimento exige `APP_SECRET_KEY` (32 bytes aleatórios em base64), usada em AES-256-GCM; não a coloque no Git. A operação alvo e a validação de credenciais são Windows.

## Versionamento e GitHub

Versione o código-fonte, os testes, a documentação, as configurações e o `package-lock.json`. O `.gitignore` exclui dependências, builds (`dist/` e `public/`), bancos SQLite, dados/mídias locais, backups, logs, resultados de testes, arquivos `.env` e chaves/certificados privados. O `.env.example` contém apenas exemplos e pode ser versionado. Se usar `APP_DATA_DIR` dentro do projeto, mantenha-o em `.local-data/` ou acrescente o caminho personalizado ao `.gitignore`.

Antes de cada commit, confira os arquivos com `git status` e revise o conteúdo preparado com `git diff --cached`. Credenciais e dados pessoais devem permanecer fora do repositório.

Para publicar pela primeira vez, crie no GitHub um repositório vazio e, após revisar e criar o commit inicial local, conecte-o:

```powershell
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

O workflow `.github/workflows/ci.yml` executa TypeScript, testes, build e testes de navegador em Windows com Node.js 22, em pushes para `main` e pull requests. As verificações usam dados e credenciais fictícios e não precisam de secrets de contas no GitHub.
