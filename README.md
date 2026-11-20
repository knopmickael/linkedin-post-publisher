# Publica · LinkedIn Post Publisher

Aplicação local para Windows: notícias de tecnologia e segurança via RSS, conteúdo informativo por IA ou escrita manual, revisão e publicação no **perfil pessoal** do LinkedIn. Somente texto, imagem única, galeria de 2 a 20 imagens, GIF animado ou vídeo MP4. **Sem PDF e sem Codex local.**

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

### Imagens, GIFs e vídeos

A modalidade atual de compartilhamento da cota não suporta geração de imagens. Os rascunhos com IA oferecem conceitos/prompts para copiar e usar no ChatGPT. Baixe as imagens e importe no painel. JPG, PNG e WebP estáticos aceitam até 20 MiB por arquivo; são convertidos para PNG, com dimensões ajustadas e metadados removidos.

Na seção **Mídias do post**, escolha o formato e importe a quantidade configurada. Imagens estáticas e GIFs exigem descrição alternativa para aprovação. Imagens estáticas permitem títulos curtos na arte e reordenação na galeria. GIFs mantêm a animação e não recebem overlay. PDF não é aceito nem gerado.

| Formato | Limites adotados |
| --- | --- |
| Somente texto | 1 a 3.000 caracteres para aprovar; sem arquivo |
| Imagem única | 1 JPG/PNG/WebP; até 20 MiB de entrada |
| Galeria | 2 a 20 imagens estáticas |
| GIF animado | 1 GIF; até 20 MiB (limite local), no máximo 250 quadros, menos de 36.152.320 pixels por quadro/canvas |
| Vídeo | 1 MP4 com trilha de vídeo; 75.000 a 500.000.000 bytes; 3 segundos a 30 minutos |

GIF e vídeo são mídias únicas, sem mistura com galerias. Para mudar de tipo, remova primeiro os arquivos incompatíveis. O servidor verifica o conteúdo real, independentemente do nome/MIME enviado pelo navegador. MP4 é inspecionado com `mp4box`, sem FFmpeg, transcodificação ou extração de amostras. Upload e envio de vídeo usam arquivos/fluxos; a prévia suporta requisições Range. A descrição do vídeo é uma referência local, não uma legenda nem um campo altText enviado à API.

Os limites de GIF vêm da [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api). Para MP4, a aplicação adota os **500 MB conservadores** da seção de especificações da [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api), embora o campo de inicialização também mencione um teto maior. Compatibilidade de codec/processamento é confirmada pelo LinkedIn antes da criação do post. Não há geração de vídeo por IA.

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

1. Abra o rascunho e revise texto, hashtags e fonte (quando houver).
2. Escolha somente texto, imagem única, galeria, GIF ou vídeo; defina a quantidade quando aplicável e salve.
3. Importe as mídias, salve descrições/títulos disponíveis para o tipo e confira a prévia aproximada.
4. Clique **Aprovar revisão**.
5. Clique **Publicar no LinkedIn** e confirme. Este é o único caminho de criação de posts remotos.

A aplicação inicializa imagens/GIFs em `/rest/images`. Para vídeo, inicializa em `/rest/videos`, envia as partes indicadas, reúne os ETags e finaliza o upload. Consulta a disponibilidade do vídeo antes de criar o post. Somente texto omite `content`. A criação usa `/rest/posts` com autor pessoal, registra a URN retornada e marca o formato como validado somente após sucesso real. A versão da API é configurável; padrão inicial `202610`.

`w_member_social` pode não permitir GET de status da imagem; o fluxo não exige essa leitura para imagens/GIFs. Se uma mídia ainda estiver processando, aguarde, aprove novamente e tente pelo botão: uploads finalizados da mesma revisão são reaproveitados. Para vídeo, recusa da consulta de processamento é apresentada antes da criação, sem presumir permissões. Permissões/formatos não autorizados aparecem como erro; use **Exportar texto e mídias (.zip)** para publicação manual. O ZIP preserva PNG/GIF/MP4 e suas descrições.

**Resultado incerto:** timeout, erro de servidor ou interrupção após início da criação bloqueiam novo envio. Confira o perfil, depois registre no painel a URL do post encontrado ou confirme sua ausência. Não há retry automático de criação. Uma edição invalida a aprovação. Posts publicados não são editados remotamente por este produto.

## Criar uma publicação

Você decide quando criar cada rascunho. **Gerar agora** abre um modal com o assunto acima de três opções:

- **Gerar notícia (IA):** pesquisa notícia verificável dos últimos sete dias e cria texto com fonte e três hashtags.
- **Manual:** cria um rascunho vazio imediatamente e abre o editor, sem conexão com IA. O assunto é opcional e pode servir como título inicial. O texto pode ser salvo vazio, mas só é aprovado quando preenchido.
- **Dissertar (IA):** exige assunto e gera conteúdo informativo e didático, como tópicos e aplicações de Kubernetes, com três hashtags. Não exige RSS nem inventa uma notícia ou fonte.

As hashtags fazem parte do corpo editável e contam para o limite de 3.000 caracteres. Os modos com IA criam execuções acompanháveis na aba **Execuções**; Manual continua disponível mesmo durante outra geração. Nenhum conteúdo é publicado automaticamente.

As opções com IA começam com imagem única; Manual começa com somente texto. Altere formato e quantidade em **Mídias do post**. A CLI `generate` continua gerando notícias e aceita `--count`. O histórico editorial fica no SQLite.

O campo **Assunto da publicação** fica dentro do modal e aceita até 500 caracteres. Em **Gerar notícia**, ele é opcional: o modelo seleciona uma notícia relacionada e produz texto/conceitos visuais nesse foco, substituindo os temas predefinidos apenas nessa execução. Em **Dissertar**, o assunto é obrigatório. O assunto e o modo ficam registrados na aba **Execuções**. Enter no campo inicia a opção de notícia quando habilitada.

Para notícia, campo vazio ou somente espaços mantém os assuntos predefinidos abaixo. A coleta usa feeds habilitados e notícias verificáveis dos últimos sete dias. Se não houver notícia adequada ao assunto informado, o resultado será **Sem pauta**, sem trocar de tema. Para assuntos fora da cobertura, adicione fontes em **Configurações → Fontes de notícias**. Esse requisito de recência não se aplica a Dissertar.

Para remover uma publicação em qualquer estado (**Rascunho**, **Aprovado**, **Publicando**, **Publicado** ou **Falha**), use a lixeira no canto superior direito do card em Publicações e confirme no modal. A exclusão remove o registro local; não exclui nem cancela o envio de um post no LinkedIn. A listagem e os contadores são atualizados após a exclusão. A execução de geração permanece no histórico, sem link para a publicação removida.

### Foco de pesquisa

- **Notícias do mundo da tecnologia em primeiro lugar:** software, hardware, sistemas operacionais, serviços, empresas e infraestrutura.
- **Grande destaque para novas vulnerabilidades**, falhas críticas, exploração confirmada e correções de segurança. CVE, gravidade, versões afetadas e mitigação só entram quando sustentados pela fonte.
- **AI / inteligência artificial, Cloud, System Design, arquitetura de software, performance e escalabilidade** continuam cobertos, sem exclusividade.

A seleção exige uma notícia verificável dos últimos sete dias com impacto técnico ou de mercado dentro desses temas. Fontes primárias têm preferência para anúncios e dados; cobertura jornalística complementa o contexto de empresas e mercado.

Os feeds incluem CERT-EU e BleepingComputer (prioridade inicial 5), Ars Technica (4), OpenAI, Google DeepMind, Hugging Face, NVIDIA, TechCrunch AI, AWS, Google Cloud, AWS Architecture, Cloudflare e Netflix Engineering. A coleta consulta até três artigos recentes por feed e percorre todas as fontes habilitadas. A prioridade orienta a seleção editorial, sem dispensar verificação e relevância.

Uma migração adiciona as três novas fontes de tecnologia/segurança **sem desabilitar nem reconfigurar fontes existentes**. Ela não se reaplica; alterações posteriores permanecem sob controle do usuário. A migração de publicações preserva IDs, revisões, aprovações, histórico e uploads antigos, permitindo novos rascunhos sem notícia associada.

## CLI e backup

```powershell
node dist/cli.js generate --count 3
node dist/cli.js generate --subject "Agentes de IA no desenvolvimento de software"
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
