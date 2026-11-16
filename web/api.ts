let csrf = '';
export async function initialize() {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Não foi possível abrir a sessão local. Confira a origem do painel.');
  csrf = (await response.json()).csrf;
}
export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(url, { method, headers: { ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}), ...(!isForm && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(' '));
  return data as T;
}
