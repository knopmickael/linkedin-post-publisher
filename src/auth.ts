import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Db } from './db.js';
import { lease, setting, setSetting } from './db.js';
import type { Config } from './config.js';
import { Vault } from './vault.js';
import { AppError } from './errors.js';
import { formRequest } from './http.js';

export type Tokens = { access_token: string; refresh_token?: string; id_token?: string; expires_at: number; scope: string; client_id: string; subject: string; label: string };
type Pending = { nonce: string; verifier: string; redirect: string; client: string; subject?: string };
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), id_token: z.string().optional(), expires_in: z.coerce.number().positive(), scope: z.string().optional() });
const openaiJwks = createRemoteJWKSet(new URL('https://auth.openai.com/.well-known/jwks.json'));
const linkedinJwks = createRemoteJWKSet(new URL('https://www.linkedin.com/oauth/openid/jwks'));
const openaiScopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

export class Auth {
  private listener?: Server;
  constructor(private db: Db, private vault: Vault, private config: Config) {}

  async start(provider: 'openai' | 'linkedin', fresh = false) {
    const nonce = randomBytes(24).toString('base64url'), state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const saved = fresh ? undefined : await this.vault.get<Tokens>(provider);
    let client: string; let redirect: string; let url: URL;
    if (provider === 'openai') {
      await this.ensureListener();
      client = saved?.client_id ?? setting<string | null>(this.db, 'openaiClient', null) ?? 'dynamic_agent_client';
      if (fresh) client = 'dynamic_agent_client';
      redirect = 'http://127.0.0.1:1455/auth/openai/callback';
      let host = setting(this.db, 'openaiHost', '');
      if (!host) { host = `urn:uuid:${randomUUID()}`; setSetting(this.db, 'openaiHost', host); }
      url = new URL('https://auth.openai.com/api/accounts/authorize');
      url.searchParams.set('ext_agent_host_id', host);
      url.searchParams.set('resource', 'https://api.openai.com/v1');
      url.searchParams.set('scope', openaiScopes);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      if (client === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', 'LinkedIn Post Publisher');
      // Do not return ID tokens to the frontend in authorization URLs. Returning
      // sign-in may show the account selector; identity is still checked below.
    } else {
      const cfg = await this.vault.get<{ clientId: string; clientSecret: string }>('linkedinConfig');
      if (!cfg) throw new AppError('Salve o Client ID e o Client Secret do LinkedIn primeiro.');
      client = cfg.clientId; redirect = `${this.config.origin}/auth/linkedin/callback`;
      url = new URL('https://www.linkedin.com/oauth/v2/authorization'); url.searchParams.set('scope', 'openid profile w_member_social');
    }
    url.searchParams.set('client_id', client); url.searchParams.set('redirect_uri', redirect); url.searchParams.set('response_type', 'code'); url.searchParams.set('state', state); url.searchParams.set('nonce', nonce);
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(Date.now());
    this.db.prepare('INSERT INTO oauth_states VALUES (?,?,?,?)').run(state, provider, JSON.stringify({ nonce, verifier, redirect, client, subject: saved?.subject } satisfies Pending), Date.now() + 10 * 60_000);
    return url.toString();
  }

  async callback(provider: 'openai' | 'linkedin', params: URLSearchParams) {
    const state = params.get('state') ?? '';
    const row = this.db.prepare('SELECT payload FROM oauth_states WHERE state=? AND provider=? AND expires_at>?').get(state, provider, Date.now()) as { payload: string } | undefined;
    if (!row) throw new AppError('Autorização expirada ou state inválido. Inicie a conexão novamente.');
    this.db.prepare('DELETE FROM oauth_states WHERE state=?').run(state);
    if (params.has('error')) throw new AppError('Autorização não concedida. Conecte novamente e confira as permissões.');
    const pending = JSON.parse(row.payload) as Pending;
    const code = params.get('code'); if (!code) throw new AppError('Código OAuth ausente.');
    let client = pending.client;
    if (provider === 'openai') {
      const supplied = params.get('client_id');
      if (client === 'dynamic_agent_client') { if (!supplied || supplied === 'dynamic_agent_client') throw new AppError('Registro dinâmico não concluído.'); client = supplied; }
      else if (supplied && supplied !== client) throw new AppError('Client ID diferente da autorização iniciada.');
    }
    const form: Record<string, string> = { grant_type: 'authorization_code', code, client_id: client, redirect_uri: pending.redirect };
    let endpoint: string;
    if (provider === 'openai') { endpoint = 'https://auth.openai.com/api/accounts/oauth/token'; form.code_verifier = pending.verifier; form.resource = 'https://api.openai.com/v1'; }
    else { endpoint = 'https://www.linkedin.com/oauth/v2/accessToken'; const cfg = await this.vault.get<{ clientSecret: string }>('linkedinConfig'); form.client_secret = cfg!.clientSecret; }
    const data = tokenSchema.parse(await formRequest(endpoint, form));
    if (!data.id_token) throw new AppError('O provedor não retornou ID token. Confira as permissões OIDC.');
    const { payload } = await jwtVerify(data.id_token, provider === 'openai' ? openaiJwks : linkedinJwks, { issuer: provider === 'openai' ? 'https://auth.openai.com' : 'https://www.linkedin.com/oauth', audience: client, algorithms: ['RS256'] });
    if (!payload.sub || (provider === 'openai' && payload.nonce !== pending.nonce) || (provider === 'linkedin' && payload.nonce !== undefined && payload.nonce !== pending.nonce)) throw new AppError('Identidade ou nonce inválido.');
    if (pending.subject && pending.subject !== payload.sub) throw new AppError('Conta diferente da selecionada. Use a opção de nova conta.');
    let scope = data.scope ?? '';
    if (provider === 'openai' && !scope.split(' ').includes('chatgpt.tokens.use.direct')) throw new AppError('Conta sem autorização para compartilhar a cota Plus com este aplicativo.');
    if (provider === 'linkedin') {
      if (!scope) throw new AppError('O LinkedIn não informou os scopes concedidos.');
      if (!scope.split(/[ ,]+/).includes('w_member_social')) throw new AppError('Permissão w_member_social não concedida.');
      // Userinfo validates the identity used as the personal author (not an organization).
      const response = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new AppError('Não foi possível identificar o perfil pessoal.');
      const user = await response.json() as { sub?: string };
      if (user.sub !== payload.sub) throw new AppError('Identidades LinkedIn divergentes.');
    }
    const tokens: Tokens = { ...data, scope, expires_at: Date.now() + data.expires_in * 1000, client_id: client, subject: payload.sub, label: String(payload.email ?? payload.name ?? payload.sub) };
    await this.vault.put(provider, tokens);
    if (provider === 'openai') setSetting(this.db, 'openaiClient', client);
    setSetting(this.db, `${provider}Connection`, { connected: true, label: tokens.label, expiresAt: tokens.expires_at, scope });
  }

  async access(provider: 'openai' | 'linkedin') {
    let data = await this.vault.get<Tokens>(provider);
    if (!data) throw new AppError(`Conecte sua conta ${provider === 'openai' ? 'ChatGPT' : 'LinkedIn'} nas configurações.`, 409, 'not_connected');
    if (data.expires_at > Date.now() + 120_000) return data;
    if (provider === 'linkedin' || !data.refresh_token) throw new AppError('Sessão expirada. Reconecte a conta nas configurações.', 409, 'session_expired');
    const lock = lease(this.db, 'openai-refresh', 90);
    try {
      data = (await this.vault.get<Tokens>(provider))!;
      if (data.expires_at > Date.now() + 120_000) return data;
      const refreshed = tokenSchema.parse(await formRequest('https://auth.openai.com/api/accounts/oauth/token', { grant_type: 'refresh_token', client_id: data.client_id, refresh_token: data.refresh_token!, resource: 'https://api.openai.com/v1' }));
      if (!refreshed.refresh_token) throw new AppError('Renovação sem refresh token. Reconecte a conta.');
      data = { ...data, ...refreshed, scope: refreshed.scope ?? data.scope, expires_at: Date.now() + refreshed.expires_in * 1000 };
      if (!data.scope.split(' ').includes('chatgpt.tokens.use.direct')) throw new AppError('Compartilhamento da cota não está mais autorizado.');
      await this.vault.put(provider, data); setSetting(this.db, 'openaiConnection', { connected: true, label: data.label, expiresAt: data.expires_at, scope: data.scope });
      return data;
    } finally { lock.release(); }
  }
  async disconnect(provider: 'openai' | 'linkedin') {
    let revoked = provider === 'linkedin';
    const data = await this.vault.get<Tokens>(provider);
    if (provider === 'openai' && data?.refresh_token) {
      try { const response = await fetch('https://auth.openai.com/api/accounts/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: data.refresh_token, token_type_hint: 'refresh_token', client_id: data.client_id }), signal: AbortSignal.timeout(15000) }); revoked = response.ok; } catch { revoked = false; }
    }
    this.vault.remove(provider); setSetting(this.db, `${provider}Connection`, { connected: false });
    return { message: revoked ? 'Conexão local removida. Você também pode gerenciar o acesso nas configurações do provedor.' : 'Conexão local removida; revogação remota não confirmada. Desconecte o aplicativo nas configurações do ChatGPT.' };
  }
  private async ensureListener() {
    if (this.listener?.listening) return;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1:1455');
      if (req.method !== 'GET' || url.pathname !== '/auth/openai/callback' || req.headers.host !== '127.0.0.1:1455') { res.writeHead(404).end(); return; }
      try { await this.callback('openai', url.searchParams); res.writeHead(302, { Location: `${this.config.origin}/?connected=openai`, 'Referrer-Policy': 'no-referrer' }).end(); }
      catch (error) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer' }).end(error instanceof AppError ? error.message : 'Não foi possível validar a autenticação. Volte ao painel e confira a elegibilidade/permissões, depois conecte novamente.'); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(1455, '127.0.0.1', resolve); }); this.listener = server;
  }
  async close() { if (this.listener) await new Promise<void>(resolve => this.listener!.close(() => resolve())); }
}
