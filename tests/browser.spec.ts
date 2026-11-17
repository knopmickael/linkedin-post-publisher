import { test, expect } from '@playwright/test';
import path from 'node:path';
import sharp from 'sharp';
import { openDb } from '../src/db.js';
import { seedPost } from './helpers.js';
import { loadEnv } from 'vite';

test('assunto opcional direciona a geração e campo vazio mantém os assuntos predefinidos', async ({ page }) => {
  const errors: string[] = [], failures: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failures.push(request.url()));
  const payloads: object[] = [];
  let subject: string | null = null, fail = false;
  await page.route('**/api/runs', route => route.fulfill({ json: payloads.length ? [{ id: 'subject-run', status: 'sem_pauta', stage: 'concluido', subject, started_at: new Date().toISOString(), detail: 'Nenhuma notícia adequada nas fontes consultadas.' }] : [] }));
  await page.route('**/api/generate', async route => {
    const payload = route.request().postDataJSON();
    if (fail) { await route.fulfill({ status: 409, json: { error: 'Geração já em andamento.' } }); return; }
    payloads.push(payload); subject = payload.subject ?? null;
    await route.fulfill({ status: 202, json: { message: 'Geração iniciada.' } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Suas publicações.' })).toBeVisible();
  expect(await page.locator('main').ariaSnapshot()).toContain('Assunto da publicação (opcional)');
  const input = page.getByRole('textbox', { name: 'Assunto da publicação (opcional)', exact: true });
  await expect(input).toHaveAttribute('maxlength', '500');
  await expect(page.locator('#generation-subject-help')).toContainText('Se deixar em branco');
  await input.fill('  Agentes de IA no desenvolvimento  ');
  await page.screenshot({ path: 'test-results/subject-desktop.png' });
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Execuções.' })).toBeVisible();
  await expect(page.locator('.run-subject')).toHaveText('Assunto: Agentes de IA no desenvolvimento');
  expect(payloads).toEqual([{ subject: 'Agentes de IA no desenvolvimento' }]);
  await page.getByRole('button', { name: /Publicações/ }).click();
  await expect(input).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/subject-mobile.png' });
  for (const value of ['', '   ']) {
    await input.fill(value);
    await page.getByRole('button', { name: 'Gerar agora' }).click();
    await expect(page.getByRole('heading', { name: 'Execuções.' })).toBeVisible();
    await expect(page.locator('.run-subject')).toContainText('Assuntos predefinidos do sistema');
    await page.getByRole('button', { name: /Publicações/ }).click();
  }
  expect(payloads).toEqual([{ subject: 'Agentes de IA no desenvolvimento' }, {}, {}]);
  fail = true;
  await input.fill('Cloud e escalabilidade');
  await page.getByRole('button', { name: 'Gerar agora' }).click();
  await expect(page.getByRole('alert')).toContainText('Geração já em andamento.');
  await expect(input).toHaveValue('Cloud e escalabilidade');
  await expect(page.getByRole('button', { name: 'Gerar agora' })).toBeEnabled();
  expect(errors).toEqual([]); expect(failures).toEqual([]);
});

test('lixeira remove publicações de todos os estados sem acessar o LinkedIn', async ({ page }) => {
  const db = openDb(path.resolve('.local-data', 'browser-tests'));
  const posts = ['rascunho', 'aprovado', 'publicando', 'publicado', 'falha'].map(status => {
    const id = seedPost(db), title = `Remoção ${status}: ${id}`;
    db.prepare('UPDATE posts SET status=? WHERE id=?').run(status, id);
    db.prepare('UPDATE news SET title=? WHERE id=(SELECT news_id FROM posts WHERE id=?)').run(title, id);
    return { id, title };
  });
  db.close();
  const linkedinRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname.endsWith('linkedin.com')) linkedinRequests.push(request.url()); });
  await page.goto('/');
  for (const post of posts) {
    const remove = page.getByRole('button', { name: `Remover publicação: ${post.title}`, exact: true });
    await expect(remove).toBeVisible(); await remove.click();
    await page.getByRole('dialog', { name: 'Remover publicação?' }).getByRole('button', { name: 'Remover publicação', exact: true }).click();
    await expect(remove).toHaveCount(0);
  }
  await page.reload();
  for (const post of posts) await expect(page.getByRole('button', { name: `Remover publicação: ${post.title}`, exact: true })).toHaveCount(0);
  expect(linkedinRequests).toEqual([]);
});

test('copia o texto atual e abre a conversa configurada; informa falha ao copiar', async ({ page, context }) => {
  const conversationUrl = loadEnv('production', process.cwd()).VITE_CHATGPT_CONVERSATION_URL;
  test.skip(!conversationUrl, 'Configure VITE_CHATGPT_CONVERSATION_URL antes do build para validar a conversa.');
  const db = openDb(path.resolve('.local-data', 'browser-tests')); seedPost(db); db.close();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.route(conversationUrl, route => route.fulfill({ contentType: 'text/html', body: '<h1>Conversa de teste</h1>' }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/'); await page.getByRole('button', { name: /Spring Boot: atualização prática/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Revise e compartilhe.' })).toBeVisible();
  expect(await page.locator('main').ariaSnapshot()).toContain('Copiar publicação e abrir ChatGPT');
  const text = 'Texto atual, ainda não salvo.\n\nCom acentuação e fonte: https://spring.io/';
  await page.getByLabel('Texto da publicação', { exact: true }).fill(text);
  const button = page.getByRole('button', { name: 'Copiar publicação e abrir ChatGPT ↗', exact: true });
  const upload = page.getByRole('button', { name: /Importar imagens/ });
  expect((await button.boundingBox())!.y).toBeLessThan((await upload.boundingBox())!.y);
  const popupEvent = page.waitForEvent('popup'); await button.focus(); await page.keyboard.press('Enter');
  const popup = await popupEvent; await popup.waitForURL(conversationUrl);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close(); await page.bringToFront();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(text);
  await expect(page.getByRole('status')).toContainText('Texto da publicação copiado');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(button).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); }; });
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível copiar o texto');
  await expect(button).toBeEnabled();
  await page.getByLabel('Texto da publicação', { exact: true }).fill('');
  await expect(button).toBeDisabled();
});

test('painel, revisão, importação, aprovação, exportação e responsividade', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const db = openDb(path.resolve('.local-data', 'browser-tests')); const id = seedPost(db); db.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Suas publicações.' })).toBeVisible();
  await page.getByRole('button', { name: /Spring Boot: atualização prática/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Revise e compartilhe.' })).toBeVisible();
  await page.getByLabel('Texto da publicação', { exact: true }).fill('Texto técnico revisado com impacto concreto.\n\nFonte: https://spring.io/');
  await page.getByRole('button', { name: /Salvar alterações/ }).click();
  await expect(page.getByRole('status')).toContainText('Alterações salvas');
  const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3869cc' } }).png().toBuffer();
  await page.locator('#images-upload').setInputFiles({ name: 'technical.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('status')).toContainText('Imagens importadas');
  await page.getByRole('button', { name: 'Aprovar revisão' }).click();
  await expect(page.getByRole('status')).toContainText('Revisão aprovada');
  await expect(page.getByRole('button', { name: /Publicar no LinkedIn/ })).toBeDisabled();
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('link', { name: /Exportar texto e imagens/ }).click(); const download = await downloadEvent; expect(download.suggestedFilename()).toContain(id);
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Revise e compartilhe.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.getByRole('heading', { name: 'Seu workspace.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  expect(errors).toEqual([]);
});

test('galeria permite importação múltipla, reordenação, substituição e título sem PDF', async ({ page }) => {
  const db = openDb(path.resolve('.local-data', 'browser-tests')); const id = seedPost(db, 2); db.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/'); await page.getByRole('button', { name: /Spring Boot: atualização prática/ }).first().click();
  await expect(page.getByRole('combobox', { name: 'Formato', exact: true })).toHaveValue('gallery');
  expect(await page.getByRole('combobox', { name: 'Formato', exact: true }).locator('option').allTextContents()).toEqual(['Imagem única', 'Galeria de imagens']);
  const one = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2865dd' } }).png().toBuffer();
  const two = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a997f' } }).png().toBuffer();
  await page.locator('#images-upload').setInputFiles([{ name: 'one.png', mimeType: 'image/png', buffer: one }, { name: 'two.png', mimeType: 'image/png', buffer: two }]);
  await expect(page.getByRole('status')).toContainText('Imagens importadas');
  await expect(page.locator('.media-editor')).toHaveCount(2);
  const imageBefore = await page.locator('.media-editor>img').first().getAttribute('src');
  await page.getByRole('button', { name: 'Mover imagem 1 para baixo', exact: true }).click();
  await expect(page.locator('.media-editor>img').nth(1)).toHaveAttribute('src', imageBefore!);
  await page.getByRole('button', { name: 'Aprovar revisão' }).click();
  await expect(page.getByRole('status')).toContainText('Revisão aprovada');
  await page.locator('input[aria-label="Substituir arquivo da imagem 1"]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: one });
  await expect(page.getByRole('status')).toContainText('Imagem substituída');
  await expect(page.locator('.page-heading .badge')).toContainText('Rascunho');
  await page.getByLabel('Título aplicado na arte (opcional)').first().fill('Uma mudança prática');
  await page.getByRole('button', { name: 'Salvar imagem', exact: true }).first().click();
  await expect(page.getByLabel('Título aplicado na arte (opcional)').first()).toHaveValue('Uma mudança prática');
  await expect(page.getByRole('button', { name: 'Salvar imagem', exact: true }).first()).toBeDisabled();
  await page.getByRole('button', { name: 'Aprovar revisão' }).click();
  await expect(page.getByRole('status')).toContainText('Revisão aprovada');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/gallery-desktop.png', fullPage: true });
  const persisted = openDb(path.resolve('.local-data', 'browser-tests'));
  try { const post = persisted.prepare('SELECT status,format FROM posts WHERE id=?').get(id) as { status: string; format: string }; expect(post).toEqual({ status: 'aprovado', format: 'gallery' }); } finally { persisted.close(); }
});

test('configurações mostram estado de conexão e permitem salvar e conectar sem o botão geral', async ({ page }) => {
  let configured = false;
  let connections = 0;
  await page.route('**/api/status', async route => {
    const response = await route.fetch(); const status = await response.json();
    await route.fulfill({ json: { ...status, hasLinkedinConfig: configured, openai: { connected: false }, linkedin: { connected: false } } });
  });
  await page.route('**/api/auth/linkedin/start', async route => {
    const payload = route.request().postDataJSON();
    expect(payload.clientId).toBe('fake-client'); expect(payload.clientSecret).toBe('fake-secret'); expect(payload.version).toBe('202610');
    configured = true; connections++;
    await route.fulfill({ json: { url: 'about:blank#linkedin-test' } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.locator('.integration-heading .badge')).toHaveText(['Não conectado', 'Não conectado']);
  await expect(page.getByRole('button', { name: 'Conectar LinkedIn', exact: true })).toBeDisabled();
  await expect(page.locator('#linkedin-connect-help')).toContainText('Preencha Client ID e Client Secret');
  await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('fake-client');
  await expect(page.getByRole('button', { name: 'Salvar e conectar LinkedIn', exact: true })).toBeDisabled();
  await page.getByLabel('Client Secret', { exact: true }).fill('fake-secret');
  await expect(page.getByRole('button', { name: 'Salvar e conectar LinkedIn', exact: true })).toBeEnabled();
  const popupEvent = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Salvar e conectar LinkedIn', exact: true }).click();
  const popup = await popupEvent; await popup.waitForURL('about:blank#linkedin-test'); await popup.close();
  await expect(page.getByRole('button', { name: 'Conectar LinkedIn', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Client ID', exact: true })).toHaveValue('');
  await expect(page.getByLabel('Client Secret', { exact: true })).toHaveValue('');
  await expect(page.locator('#linkedin-connect-help')).toContainText('As credenciais já estão salvas');
  expect(connections).toBe(1);
});

test('publicações geram sem seletor e removem qualquer estado com confirmação acessível', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const db = openDb(path.resolve('.local-data', 'browser-tests'));
  const id = seedPost(db), approvedId = seedPost(db);
  const draftTitle = `AI: rascunho para remover ${id.slice(0, 8)}`, approvedTitle = `Cloud: publicação aprovada ${approvedId.slice(0, 8)}`;
  db.prepare('UPDATE news SET title=? WHERE id=(SELECT news_id FROM posts WHERE id=?)').run(draftTitle, id);
  db.prepare('UPDATE news SET title=? WHERE id=(SELECT news_id FROM posts WHERE id=?)').run(approvedTitle, approvedId);
  db.prepare("UPDATE posts SET status='aprovado' WHERE id=?").run(approvedId); db.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Suas publicações.' })).toBeVisible();
  expect(await page.locator('main').ariaSnapshot()).toContain('Suas publicações');
  await expect(page.locator('.generate-actions select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Remover publicação: ${approvedTitle}`, exact: true })).toBeVisible();
  const remove = page.getByRole('button', { name: `Remover publicação: ${draftTitle}`, exact: true });
  await page.screenshot({ path: 'test-results/posts-desktop.png', fullPage: true });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Remover publicação?' });
  await expect(dialog).toContainText('Isso não exclui nem cancela o envio de um post no LinkedIn.');
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Suas publicações.' })).toBeVisible();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Remover publicação', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(remove).toBeFocused();
  await remove.click(); await dialog.getByRole('button', { name: 'Cancelar' }).click(); await expect(remove).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await remove.click(); await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/delete-draft-mobile.png', fullPage: true });
  await page.route(`**/api/posts/${id}`, async route => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 409, json: { error: 'O conteúdo mudou. Reabra o post.' } }); else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Remover publicação', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('O conteúdo mudou'); await expect(remove).toBeVisible();
  await page.unroute(`**/api/posts/${id}`);
  await dialog.getByRole('button', { name: 'Remover publicação', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(remove).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Publicação removida da aplicação');
  await expect(page.getByRole('button', { name: 'Gerar agora' })).toBeFocused();
  await page.reload(); await expect(remove).toHaveCount(0);
  const persisted = openDb(path.resolve('.local-data', 'browser-tests'));
  try { expect(persisted.prepare('SELECT 1 FROM posts WHERE id=?').get(id)).toBeUndefined(); expect(persisted.prepare('SELECT status FROM posts WHERE id=?').get(approvedId)).toEqual({ status: 'aprovado' }); } finally { persisted.close(); }
  const approvedRemove = page.getByRole('button', { name: `Remover publicação: ${approvedTitle}`, exact: true });
  await approvedRemove.click(); await dialog.getByRole('button', { name: 'Remover publicação', exact: true }).click();
  await expect(approvedRemove).toHaveCount(0);
  await page.route('**/api/generate', async route => { expect(route.request().postDataJSON()).toEqual({}); await route.fulfill({ status: 202, json: { message: 'Geração iniciada.' } }); });
  await page.getByRole('button', { name: 'Gerar agora' }).click(); await expect(page.getByRole('heading', { name: 'Execuções.' })).toBeVisible();
  expect(errors).toEqual([]);
});
