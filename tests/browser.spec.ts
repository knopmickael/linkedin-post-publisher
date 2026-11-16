import { test, expect } from '@playwright/test';
import path from 'node:path';
import sharp from 'sharp';
import { openDb } from '../src/db.js';
import { seedPost } from './helpers.js';

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
