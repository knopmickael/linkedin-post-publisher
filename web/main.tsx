import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, initialize } from './api';
import type { Feed, Media, Post, Run, Status, Summary } from './types';
import './style.css';
import './publications.css';

const date = (value: string | number) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Ocorreu um erro inesperado.';
const chatgptConversationUrl = import.meta.env.VITE_CHATGPT_CONVERSATION_URL;
const labels: Record<string, string> = { rascunho: 'Rascunho', aprovado: 'Aprovado', publicando: 'Publicando', publicado: 'Publicado', falha: 'Falha', executando: 'Em andamento', concluido: 'Concluído', sem_pauta: 'Sem pauta' };
function Badge({ value }: { value: string }) { return <span className={`badge ${value}`}>{labels[value] ?? value}</span>; }
function ConnectionBadge({ connected }: { connected: boolean }) {
  return <span className={`badge ${connected ? 'publicado' : 'sem_pauta'}`}>{connected ? 'Conectado' : 'Não conectado'}</span>;
}
type Notify = (text: string, error?: boolean) => void;

function App() {
  const [ready, setReady] = useState(false), [tab, setTab] = useState('posts'), [status, setStatus] = useState<Status>(), [posts, setPosts] = useState<Summary[]>([]), [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string>(), [notice, setNotice] = useState<{ text: string; error: boolean }>(), [loading, setLoading] = useState(false), [filter, setFilter] = useState('todos'), [deleting, setDeleting] = useState<Summary>();
  const [subject, setSubject] = useState('');
  const notify: Notify = useCallback((text, error = false) => setNotice({ text, error }), []);
  const refresh = useCallback(async () => { const [s, p, r] = await Promise.all([api<Status>('/api/status'), api<Summary[]>('/api/posts'), api<Run[]>('/api/runs')]); setStatus(s); setPosts(p); setRuns(r); }, []);
  useEffect(() => { void initialize().then(refresh).then(() => setReady(true)).catch(e => notify(errorMessage(e), true)); }, [refresh, notify]);
  useEffect(() => { if (!ready) return; const timer = setInterval(() => { void refresh().catch(() => {}); }, 6000); return () => clearInterval(timer); }, [ready, refresh]);
  const generation = runs.some(r => r.status === 'executando');
  async function generate() { setLoading(true); try { const result = await api<{ message: string }>('/api/generate', 'POST', subject.trim() ? { subject: subject.trim() } : {}); setSubject(''); notify(result.message); setTab('runs'); await refresh(); } catch (e) { notify(errorMessage(e), true); } finally { setLoading(false); } }
  async function removePost(post: Summary) {
    await api(`/api/posts/${post.id}`, 'DELETE', { revision: post.revision });
    setPosts(previous => previous.filter(p => p.id !== post.id)); setDeleting(undefined); notify('Publicação removida da aplicação.');
    await refresh().catch(e => notify(errorMessage(e), true));
  }
  const nav = (value: string) => { setSelected(undefined); setTab(value); };
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Publica, início"><span className="brand-mark">p<span>·</span></span><span>publica<small>SEU REPERTÓRIO, EM DIA.</small></span></a>
      <div className="workspace"><span className="workspace-icon">in</span><div>Meu LinkedIn<small>Workspace pessoal</small></div><span className="local-dot" title="Aplicação local" /></div>
      <nav aria-label="Navegação principal">{[['posts', '▤', 'Publicações'], ['runs', '◷', 'Execuções'], ['settings', '⚙', 'Configurações']].map(([key, icon, label]) => <button key={key} className={tab === key ? 'nav active' : 'nav'} onClick={() => nav(key)}><span aria-hidden="true">{icon}</span>{label}{key === 'posts' && <small>{posts.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><strong>Gere quando quiser</strong><p>Você decide quando criar<br /><span>seu próximo rascunho.</span></p><small>Use o botão Gerar agora.<br />A publicação é sempre por você.</small><div className="local-label"><span className="local-dot" /> LOCAL · SEUS DADOS NO WINDOWS</div></div>
    </aside>
    <main>
      <header className="topbar"><span>Workspace pessoal <span className="slash">/</span> {selected ? 'Editor' : tab === 'posts' ? 'Publicações' : tab === 'runs' ? 'Execuções' : 'Configurações'}</span><span className="top-status"><span className={`local-dot ${status?.linkedin.connected ? '' : 'muted-dot'}`} />{status?.linkedin.connected ? 'LinkedIn conectado' : 'LinkedIn não conectado'}</span></header>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button onClick={() => setNotice(undefined)} aria-label="Fechar mensagem">×</button></div>}
      {!ready ? <div className="empty"><span className="spinner" /><h1>Preparando seu workspace…</h1>{notice?.error && <button onClick={() => location.reload()}>Tentar novamente</button>}</div> : selected ? <Editor id={selected} status={status!} onBack={() => setSelected(undefined)} notify={notify} refresh={refresh} /> : <div className="page">
        {tab === 'posts' && <>
          <div className="eyebrow">DO QUE IMPORTA AO QUE VOCÊ PUBLICA</div><div className="page-heading"><div><h1>Suas publicações<span className="accent">.</span></h1><p>Notícias relevantes. Sua perspectiva. Tudo no seu tempo.</p></div><div className="generate-actions"><button id="generate-post" className="primary" type="submit" form="generation-form" disabled={loading || generation}>{loading || generation ? '◌ Gerando…' : '✦ Gerar agora'}</button></div></div>
          <form id="generation-form" className="generation-subject" onSubmit={e => { e.preventDefault(); if (!loading && !generation) void generate(); }}>
            <label htmlFor="generation-subject">Assunto da publicação (opcional)</label>
            <input id="generation-subject" value={subject} maxLength={500} disabled={loading || generation} onChange={e => setSubject(e.target.value)} placeholder="Ex.: agentes de IA no desenvolvimento de software" aria-describedby="generation-subject-help" />
            <p id="generation-subject-help">Informe um assunto para direcionar a pesquisa nas fontes configuradas. Se deixar em branco, o modelo buscará notícias sobre AI, Cloud, System Design, arquitetura de software, performance e escalabilidade.</p>
          </form>
          <section className="stats" aria-label="Resumo das publicações">{[['rascunho', 'Prontos para sua revisão'], ['aprovado', 'Aprovados para publicar'], ['publicado', 'Ideias compartilhadas']].map(([key, label]) => <div key={key}><small>{labels[key]}</small><strong>{posts.filter(p => p.status === key).length.toString().padStart(2, '0')}</strong><span>{label}</span></div>)}</section>
          {!status?.openai.connected && <div className="setup-callout"><span>✦</span><div><strong>Vamos preparar sua primeira publicação?</strong><p>Conecte o ChatGPT e escolha um modelo para transformar notícias em rascunhos.</p></div><button onClick={() => nav('settings')}>Configurar integrações <span aria-hidden="true">↗</span></button></div>}
          <div className="section-heading"><h2>Seu conteúdo <span>{posts.length}</span></h2><label>Filtrar <select value={filter} onChange={e => setFilter(e.target.value)}><option value="todos">Todos os estados</option>{Object.entries(labels).filter(([k]) => ['rascunho', 'aprovado', 'publicando', 'publicado', 'falha'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
          {posts.filter(p => filter === 'todos' || p.status === filter).length ? <div className="post-grid">{posts.filter(p => filter === 'todos' || p.status === filter).map(post => <article className="post-card-container" key={post.id}><button className="post-card" onClick={() => setSelected(post.id)}><div className="card-image">{post.thumbnail ? <img src={`/api/media/${post.thumbnail}`} alt="" /> : <div className="art-placeholder"><span>✦</span><small>UMA IDEIA ESPERANDO SUA IMAGEM</small></div>}<Badge value={post.status} /></div><div className="card-body"><div className="card-meta">{post.format === 'single' ? 'IMAGEM ÚNICA' : 'GALERIA'}<span>{date(post.created_at)}</span></div><h3>{post.title}</h3><p>{post.edited_text}</p><div className="card-footer">{post.status === 'publicado' ? 'Ver publicação' : 'Abrir rascunho'} <span aria-hidden="true">↗</span></div></div></button><button className="delete-draft" aria-label={`Remover publicação: ${post.title}`} title="Remover publicação" onClick={() => setDeleting(post)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg></button></article>)}</div> : <div className="empty bordered"><div className="empty-icon">✎</div><h2>{posts.length ? 'Nenhuma publicação neste filtro' : 'Sua próxima ideia começa aqui'}</h2><p>Gere um rascunho a partir de notícias recentes.<br />Você revisa cada detalhe antes de compartilhar.</p><button onClick={() => status?.openai.connected ? void generate() : nav('settings')} className="secondary" disabled={loading || generation}>{status?.openai.connected ? '✦ Gerar primeiro rascunho' : 'Conectar minhas contas'}</button></div>}
          <p className="footer-note">○ Nenhum conteúdo é publicado automaticamente. Você tem a palavra final.</p>
        </>}
        {tab === 'runs' && <><div className="eyebrow">CADA ETAPA, COM CONTEXTO</div><h1>Execuções<span className="accent">.</span></h1><p className="subtitle">Acompanhe a pesquisa, a seleção de fontes e a geração dos rascunhos.</p>{!runs.length ? <div className="empty bordered"><h2>Ainda não há execuções</h2><p>Clique em Gerar agora após conectar o ChatGPT.</p></div> : <div className="run-list">{runs.map(run => <article className="panel run" key={run.id}><div><Badge value={run.status} /><span>{date(run.started_at)}</span></div><p className="run-subject"><strong>Assunto:</strong> {run.subject ?? 'Assuntos predefinidos do sistema'}</p><h3>{run.stage.replaceAll('_', ' ')}</h3><p>{run.detail ?? 'Aguardando próxima etapa…'}</p>{run.post_id && <button className="text-button" onClick={() => setSelected(run.post_id)}>Abrir rascunho ↗</button>}</article>)}</div>}</>}
        {tab === 'settings' && <Settings status={status!} notify={notify} refresh={refresh} />}
      </div>}
    </main>
    {deleting && <DeletePostDialog post={deleting} onCancel={() => setDeleting(undefined)} onConfirm={() => removePost(deleting)} />}
  </div>;
}

function DeletePostDialog({ post, onCancel, onConfirm }: { post: Summary; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null), cancelButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const previousFocus = document.activeElement;
    const modal = dialog.current!; modal.showModal(); cancelButton.current?.focus();
    return () => { modal.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); else document.getElementById('generate-post')?.focus(); };
  }, []);
  async function confirmRemoval() {
    setBusy(true); setError('');
    try { await onConfirm(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="delete-draft-dialog" aria-labelledby="delete-draft-title" aria-describedby="delete-draft-description" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }} onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const buttons = dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }}>
    <h2 id="delete-draft-title">Remover publicação?</h2>
    <p className="draft-to-delete">{post.title}</p>
    <p id="delete-draft-description">O texto e as imagens desta publicação serão removidos da aplicação. Isso não exclui nem cancela o envio de um post no LinkedIn. Esta ação não pode ser desfeita.</p>
    {error && <p className="delete-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button ref={cancelButton} disabled={busy} onClick={onCancel}>Cancelar</button><button className="danger" disabled={busy} onClick={() => void confirmRemoval()}>{busy ? 'Removendo…' : 'Remover publicação'}</button></div>
  </dialog>;
}

function Editor({ id, status, onBack, notify, refresh }: { id: string; status: Status; onBack: () => void; notify: Notify; refresh: () => Promise<void> }) {
  const [post, setPost] = useState<Post>(), [text, setText] = useState(''), [format, setFormat] = useState<'single' | 'gallery'>('single'), [count, setCount] = useState(1), [busy, setBusy] = useState(false), [preview, setPreview] = useState(0), [resolveUrl, setResolveUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [copying, setCopying] = useState(false);
  const load = useCallback((p: Post) => { setPost(p); setText(p.edited_text); setFormat(p.format); setCount(p.visual.desiredCount); }, []);
  useEffect(() => { void api<Post>(`/api/posts/${id}`).then(load).catch(e => notify(errorMessage(e), true)); }, [id, load, notify]);
  const dirty = !!post && (text !== post.edited_text || format !== post.format || count !== post.visual.desiredCount);
  const uncertain = post?.attempts.some(a => a.outcome === 'unknown'); const locked = !!post && (['publicando', 'publicado'].includes(post.status) || !!uncertain);
  async function action(fn: () => Promise<void>) { setBusy(true); try { await fn(); await refresh(); } catch (e) { notify(errorMessage(e), true); if (!dirty) { try { load(await api<Post>(`/api/posts/${id}`)); } catch {} } } finally { setBusy(false); } }
  async function save() { const p = await api<Post>(`/api/posts/${id}`, 'PATCH', { revision: post!.revision, text, format, count }); load(p); return p; }
  async function copyAndOpenChatGPT() {
    if (!chatgptConversationUrl) { notify('Configure VITE_CHATGPT_CONVERSATION_URL e reinicie o frontend ou refaça o build.', true); return; }
    setCopying(true);
    let conversation: Window | null = null;
    try {
      const copied = navigator.clipboard.writeText(text);
      conversation = window.open('about:blank', '_blank');
      if (conversation) conversation.opener = null;
      await copied;
      if (conversation) conversation.location.href = chatgptConversationUrl;
      else window.location.href = chatgptConversationUrl;
      notify('Texto da publicação copiado. Cole na conversa do ChatGPT com Ctrl+V.');
    } catch {
      conversation?.close();
      notify('Não foi possível copiar o texto. Permita o acesso à área de transferência e tente novamente.', true);
    } finally { setCopying(false); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = [...files]; if (fileInput.current) fileInput.current.value = '';
    await action(async () => { let p = dirty ? await save() : post!; for (const file of selectedFiles) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Somente imagens JPG, PNG ou WebP. PDF não é aceito.');
      if (file.size > 20 * 1024 * 1024) throw new Error('Limite de 20 MB por imagem.');
      const form = new FormData(); form.append('revision', String(p.revision)); form.append('altText', p.visual.slides[p.media.length]?.altText ?? ''); form.append('file', file);
      p = await api<Post>(`/api/posts/${id}/media`, 'POST', form); load(p);
    } notify('Imagens importadas. Revise as descrições alternativas e a ordem.'); });
  }
  async function mediaAction(url: string, method: string, body: object) { await action(async () => {
    if (dirty) throw new Error('Salve as alterações do texto e formato antes de editar as imagens.');
    const file = 'altText' in body && body.altText instanceof File ? body.altText : undefined;
    if (file) {
      const form = new FormData(); form.append('revision', String(post!.revision)); form.append('file', file);
      load(await api<Post>(`${url}/replace`, 'POST', form)); notify('Imagem substituída. Revise a descrição alternativa e aprove novamente.');
    } else load(await api<Post>(url, method, { revision: post!.revision, ...body }));
  }); }
  if (!post) return <div className="empty"><span className="spinner" /><p>Abrindo publicação…</p></div>;
  return <div className="page editor-page"><button className="text-button back" onClick={() => { if (!dirty || confirm('Há alterações não salvas. Deseja sair do editor?')) onBack(); }}>← Todas as publicações</button><div className="page-heading"><div><div className="eyebrow">SUA VOZ, SEU CRITÉRIO</div><h1>Revise e compartilhe<span className="accent">.</span></h1><p>{post.title}</p></div><Badge value={post.status} /></div>
    {uncertain && <section className="notice error uncertain" role="alert"><div><h2>Resultado incerto: confira seu LinkedIn</h2><p>O envio pode ter sido concluído. Verifique seu perfil antes de tentar novamente.</p><label>URL do post encontrado<input type="url" value={resolveUrl} onChange={e => setResolveUrl(e.target.value)} placeholder="https://www.linkedin.com/feed/update/…" /></label><div className="button-row"><button disabled={busy || !resolveUrl} onClick={() => void action(async () => { load(await api<Post>(`/api/posts/${id}/resolve`, 'POST', { outcome: 'published', confirmed: true, url: resolveUrl })); })}>Encontrei a publicação</button><button disabled={busy} onClick={() => { if (confirm('Você conferiu seu perfil no LinkedIn e tem certeza de que o post NÃO foi publicado?')) void action(async () => { load(await api<Post>(`/api/posts/${id}/resolve`, 'POST', { outcome: 'not_published', confirmed: true })); }); }}>Conferi: não foi publicado</button></div></div></section>}
    <div className="editor-columns"><div className="editor-main">
      <section className="panel"><div className="section-heading"><h2>01 <span>Texto da publicação</span></h2><small>{text.length} / 3.000</small></div><label className="sr-only" htmlFor="post-text">Texto da publicação</label><textarea id="post-text" className="post-text" value={text} maxLength={3000} disabled={busy || locked} onChange={e => setText(e.target.value)} /><div className="source"><span>↗</span><div><a href={post.canonical_url} target="_blank" rel="noreferrer">Conferir fonte original</a><small>{date(post.published_at)} · {post.evidence}</small></div></div></section>
      <section className="panel"><div className="section-heading"><h2>02 <span>Imagens do post</span></h2><small>{post.media.length} importada(s)</small></div><div className="form-row"><label>Formato<select disabled={busy || locked} value={format} onChange={e => { const f = e.target.value as 'single' | 'gallery'; setFormat(f); setCount(f === 'single' ? 1 : Math.max(2, count)); }}><option value="single">Imagem única</option><option value="gallery">Galeria de imagens</option></select></label><label>Quantidade<select value={count} disabled={busy || locked || format === 'single'} onChange={e => setCount(Number(e.target.value))}>{Array.from({ length: format === 'single' ? 1 : 19 }, (_, i) => i + (format === 'single' ? 1 : 2)).map(n => <option key={n}>{n}</option>)}</select></label></div><p className="muted">Importe JPG, PNG ou WebP, até 20 MB por arquivo. A aplicação envia as imagens ao LinkedIn por você.</p>
        {post.visual.slides.map((slide, i) => <details key={i}><summary>Conceito {i + 1} · {slide.purpose}</summary><p>{slide.imagePrompt}</p><button className="text-button" onClick={() => void navigator.clipboard.writeText(slide.imagePrompt).then(() => notify('Prompt copiado. Gere a imagem no ChatGPT e importe o arquivo.')).catch(() => notify('Não foi possível copiar. Selecione o texto do prompt manualmente.', true))}>Copiar prompt</button>{status.imageApiEnabled && <button disabled={busy || locked || dirty} onClick={() => { if (confirm('Gerar esta imagem pela API paga da OpenAI? Haverá cobrança separada do ChatGPT Plus.')) void mediaAction(`/api/posts/${id}/generate-image`, 'POST', { prompt: slide.imagePrompt, paidConsent: true }); }}>Gerar via API paga</button>}</details>)}
        <div className="media-list">{post.media.map((m, index) => <MediaEditor key={`${m.id}:${m.sha256}`} media={m} index={index} total={post.media.length} disabled={busy || locked} imageApiEnabled={status.imageApiEnabled} onSave={(altText, overlayText) => mediaAction(`/api/posts/${id}/media/${m.id}`, 'PATCH', { altText, overlayText })} onRemove={() => { if (confirm('Remover esta imagem do post?')) void mediaAction(`/api/posts/${id}/media/${m.id}`, 'DELETE', {}); }} onMove={direction => { const ids = post.media.map(x => x.id); [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]; void mediaAction(`/api/posts/${id}/reorder`, 'POST', { ids }); }} onRegenerate={() => { const prompt = post.visual.slides[index]?.imagePrompt ?? post.visual.visualConcept; if (!status.imageApiEnabled) { void navigator.clipboard.writeText(prompt).then(() => notify('Prompt copiado. Gere a nova imagem no ChatGPT, remova a anterior e importe a substituta.')).catch(() => notify('Copie o prompt na seção de conceitos acima.', true)); return; } if (confirm('Regenerar esta imagem pela API paga? Haverá cobrança separada do Plus.')) void mediaAction(`/api/posts/${id}/generate-image`, 'POST', { prompt, paidConsent: true, replaceId: m.id }); }} />)}</div>
        <div className="button-row"><button type="button" className="secondary" disabled={busy || copying || !text.trim()} onClick={() => void copyAndOpenChatGPT()}>{copying ? 'Copiando…' : 'Copiar publicação e abrir ChatGPT ↗'}</button></div>
        <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple id="images-upload" disabled={busy || locked} onChange={e => void upload(e.target.files)} /><button className="upload-area" disabled={busy || locked || post.media.length >= 20} onClick={() => fileInput.current?.click()}><strong>＋ Importar imagens</strong><span>Escolha um ou mais arquivos do seu computador</span></button>
      </section>
      {post.attempts.length > 0 && <section className="panel"><h2>Histórico de publicação</h2>{post.attempts.map(a => <div className="attempt" key={a.id}><strong>{a.outcome === 'unknown' ? 'Resultado incerto' : a.outcome === 'success' ? 'Publicação concluída' : a.outcome === 'active' ? 'Em andamento' : 'Tentativa não concluída'}</strong><small>{date(a.started_at)}</small><p>{a.detail}</p></div>)}</section>}
    </div><aside className="editor-aside"><section className="panel preview"><div className="eyebrow">PRÉVIA APROXIMADA</div><div className="preview-author"><span>in</span><div>{status.linkedin.label ?? 'Seu perfil pessoal'}<small>Publicação pública · LinkedIn</small></div></div><p className="preserve">{text}</p>{post.media.length ? <><img className="preview-image" src={`/api/media/${post.media[Math.min(preview, post.media.length - 1)].id}?v=${post.media[Math.min(preview, post.media.length - 1)].sha256}`} alt={post.media[Math.min(preview, post.media.length - 1)].alt_text || 'Prévia da imagem importada'} /><div className="preview-pagination">{post.media.map((m, i) => <button key={m.id} aria-label={`Ver imagem ${i + 1}`} aria-pressed={preview === i} onClick={() => setPreview(i)}>{i + 1}</button>)}</div></> : <div className="preview-placeholder">Sua imagem aparece aqui</div>}</section><section className="panel publish-panel"><h2>Pronto para compartilhar?</h2><p>Aprove o conteúdo para habilitar a publicação. Qualquer alteração exige nova aprovação.</p><button className="secondary" disabled={busy || locked || !dirty} onClick={() => void action(async () => { await save(); notify('Alterações salvas.'); })}>Salvar alterações{dirty ? ' •' : ''}</button><button className="secondary" disabled={busy || locked || dirty || post.status === 'aprovado'} onClick={() => void action(async () => { load(await api<Post>(`/api/posts/${id}/approve`, 'POST', { revision: post.revision })); notify('Revisão aprovada. O botão Publicar já pode ser usado.'); })}>✓ Aprovar revisão</button>{post.status === 'publicado' && post.published_url ? <a className="button primary" target="_blank" rel="noreferrer" href={post.published_url}>Ver no LinkedIn ↗</a> : <button className="primary" disabled={busy || dirty || post.status !== 'aprovado' || !status.linkedin.connected} onClick={() => { if (confirm('Publicar agora no seu perfil pessoal do LinkedIn? O texto e as imagens aprovados ficarão públicos.')) void action(async () => { await api(`/api/posts/${id}/publish`, 'POST', { revision: post.revision }); load(await api<Post>(`/api/posts/${id}`)); notify('Publicação enviada ao LinkedIn com sucesso.'); }); }}>{busy ? 'Processando…' : 'Publicar no LinkedIn ↗'}</button>}<a className="export-link" href={`/api/posts/${id}/export`}>↓ Exportar texto e imagens (.zip)</a>{!status.linkedin.connected && <small>Conecte o LinkedIn nas configurações para publicar.</small>}</section></aside></div>
  </div>;
}

function MediaEditor({ media, index, total, disabled, imageApiEnabled, onSave, onRemove, onMove, onRegenerate }: { media: Media; index: number; total: number; disabled: boolean; imageApiEnabled: boolean; onSave: (alt: string | File, overlay: string) => Promise<void>; onRemove: () => void; onMove: (direction: number) => void; onRegenerate: () => void }) {
  const [alt, setAlt] = useState(media.alt_text), [overlay, setOverlay] = useState(media.overlay_text);
  const replacement = useRef<HTMLInputElement>(null);
  const dirty = alt !== media.alt_text || overlay !== media.overlay_text;
  return <article className="media-editor">
    <img src={`/api/media/${media.id}?v=${media.sha256}`} alt={media.alt_text || `Imagem ${index + 1}`} />
    <div className="media-fields">
      <div className="section-heading"><strong>Imagem {index + 1}</strong><small>{media.width} × {media.height}</small></div>
      <label>Descrição para leitores de tela<textarea rows={2} maxLength={1000} disabled={disabled} value={alt} onChange={e => setAlt(e.target.value)} /></label>
      <label>Título aplicado na arte (opcional)<input maxLength={140} value={overlay} disabled={disabled} onChange={e => setOverlay(e.target.value)} /></label>
      {dirty && <p className="muted">Alterações nesta imagem ainda não foram salvas.</p>}
      <input ref={replacement} className="sr-only" aria-label={`Substituir arquivo da imagem ${index + 1}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void onSave(file, media.overlay_text); }} />
      <div className="button-row">
        <button disabled={disabled || !dirty} onClick={() => void onSave(alt, overlay)}>Salvar imagem</button>
        <button disabled={disabled} onClick={() => replacement.current?.click()}>Substituir arquivo</button>
        <button disabled={disabled} onClick={onRegenerate}>{imageApiEnabled ? 'Regenerar (API paga)' : 'Prompt para substituir'}</button>
        <button disabled={disabled || index === 0} aria-label={`Mover imagem ${index + 1} para cima`} onClick={() => onMove(-1)}>↑</button>
        <button disabled={disabled || index === total - 1} aria-label={`Mover imagem ${index + 1} para baixo`} onClick={() => onMove(1)}>↓</button>
        <button className="danger-text" disabled={disabled} onClick={onRemove}>Remover</button>
      </div>
    </div>
  </article>;
}

function Settings({ status, notify, refresh }: { status: Status; notify: Notify; refresh: () => Promise<void> }) {
  const [model, setModel] = useState(status.model), [catalog, setCatalog] = useState<Array<{ id: string; name: string }>>([]), [version, setVersion] = useState(status.linkedinVersion), [clientId, setClientId] = useState(''), [secret, setSecret] = useState(''), [paid, setPaid] = useState(status.imageApiEnabled), [imageKey, setImageKey] = useState(''), [imageModel, setImageModel] = useState(status.imageModel), [busy, setBusy] = useState(false), [feeds, setFeeds] = useState<Feed[]>([]), [feedName, setFeedName] = useState(''), [feedUrl, setFeedUrl] = useState('');
  const fetchFeeds = useCallback(async () => setFeeds(await api<Feed[]>('/api/feeds')), []);
  useEffect(() => { void fetchFeeds().catch(e => notify(errorMessage(e), true)); }, [fetchFeeds, notify]);
  async function action(fn: () => Promise<void>) { setBusy(true); try { await fn(); await refresh(); } catch (e) { notify(errorMessage(e), true); } finally { setBusy(false); } }
  const hasNewCredentials = !!(clientId.trim() || secret.trim());
  const completeCredentials = !!(clientId.trim() && secret.trim());
  const canConnectLinkedin = hasNewCredentials ? completeCredentials : status.hasLinkedinConfig;
  async function connect(provider: string, fresh = false) {
    const windowRef = window.open('about:blank', '_blank');
    await action(async () => {
      try {
        const credentials = provider === 'linkedin' && hasNewCredentials ? { clientId: clientId.trim(), clientSecret: secret.trim() } : {};
        const result = await api<{ url: string }>(`/api/auth/${provider}/start`, 'POST', { fresh, ...credentials, ...(provider === 'linkedin' ? { version } : {}) });
        if (provider === 'linkedin') { setClientId(''); setSecret(''); }
        if (windowRef) { windowRef.opener = null; windowRef.location.href = result.url; } else location.href = result.url;
      } catch (e) { windowRef?.close(); throw e; }
    });
  }
  return <><div className="eyebrow">AS CONEXÕES POR TRÁS DAS IDEIAS</div><h1>Seu workspace<span className="accent">.</span></h1><p className="subtitle">Configure as contas e as fontes que alimentam seu repertório.</p><div className="settings-grid">
    <section className="panel">
      <div className="integration-heading"><span className="integration-icon">✦</span><div><h2>ChatGPT</h2><small>Cota compartilhada do plano · OAuth</small></div><ConnectionBadge connected={status.openai.connected} /></div>
      <p>Conecte pelo fluxo oficial e autorize o uso da cota. A elegibilidade depende da sua conta. Nenhum Codex é instalado.</p>
      {status.openai.connected && <p className="connected-label">✓ {status.openai.label}<br /><small>Token válido até {status.openai.expiresAt ? date(status.openai.expiresAt) : '—'}</small></p>}
      <div className="button-row"><button className="secondary" disabled={busy} onClick={() => void connect('openai')}>Continue with ChatGPT</button><button disabled={busy} onClick={() => void connect('openai', true)}>Usar outra conta</button>{status.openai.connected && <button disabled={busy} onClick={() => void action(async () => { const r = await api<{ message: string }>('/api/auth/openai/disconnect', 'POST', {}); notify(r.message); })}>Desconectar</button>}</div>
      <hr />
      <label>Modelo para geração{catalog.length ? <select value={model} onChange={e => setModel(e.target.value)}><option value="">Selecione</option>{catalog.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select> : <input value={model} onChange={e => setModel(e.target.value)} placeholder="Carregue o catálogo após conectar" />}</label>
      <button className="text-button" disabled={busy || !status.openai.connected} onClick={() => void action(async () => { const list = await api<Array<{ id: string; name: string }>>('/api/openai/models'); setCatalog(list); notify(`${list.length} modelo(s) disponível(is). Escolha um e salve as configurações.`); })}>Atualizar modelos disponíveis ↻</button><a className="small-link" target="_blank" rel="noreferrer" href="https://chatgpt.com/settings/usage">Gerenciar cota no ChatGPT ↗</a>
    </section>
    <section className="panel">
      <div className="integration-heading"><span className="integration-icon linkedin-icon">in</span><div><h2>LinkedIn</h2><small>Perfil pessoal · publicação oficial</small></div><ConnectionBadge connected={status.linkedin.connected} /></div>
      <p>Habilite Share on LinkedIn e Sign In with LinkedIn using OpenID Connect no Developer Portal.</p>
      <label>Callback para cadastrar<input readOnly value={status.callback} onFocus={e => e.currentTarget.select()} /></label>
      <div className="form-row"><label>Client ID<input autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} placeholder={status.hasLinkedinConfig ? 'Já armazenado' : 'Client ID do aplicativo'} /></label><label>Client Secret<input type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={status.hasLinkedinConfig ? 'Já protegido no Windows' : 'Client Secret'} /></label></div>
      <label>Versão da API<input value={version} maxLength={6} pattern="20[0-9]{4}" onChange={e => setVersion(e.target.value)} /></label>
      <p className="muted" id="linkedin-connect-help">{hasNewCredentials && !completeCredentials ? 'Preencha Client ID e Client Secret juntos para conectar.' : completeCredentials ? 'Ao conectar, estas credenciais serão salvas com proteção do Windows e a autorização do LinkedIn será aberta.' : status.hasLinkedinConfig ? 'As credenciais já estão salvas. Clique para autorizar sua conta no LinkedIn.' : 'Preencha Client ID e Client Secret acima para habilitar a conexão.'}</p>
      <p className="muted">Para portais que exigem HTTPS, configure o certificado local conforme o README.</p>
      {status.linkedin.connected && <p className="connected-label">✓ {status.linkedin.label}</p>}
      <div className="button-row"><button className="secondary" disabled={busy || !canConnectLinkedin} aria-describedby="linkedin-connect-help" onClick={() => void connect('linkedin')}>{hasNewCredentials ? 'Salvar e conectar LinkedIn' : 'Conectar LinkedIn'}</button>{status.linkedin.connected && <button disabled={busy} onClick={() => void action(async () => { const r = await api<{ message: string }>('/api/auth/linkedin/disconnect', 'POST', {}); notify(r.message); })}>Desconectar</button>}</div>
      <div className="capabilities">{[['single', 'Imagem única'], ['gallery', 'Galeria']].map(([key, label]) => <span key={key}>{label}: <strong>{status.capabilities[key]?.status ?? 'não testado'}</strong></span>)}</div>
    </section>
      <section className="panel full-width"><div className="section-heading"><h2>Imagens <span className="tag">MANUAL POR PADRÃO</span></h2></div><p>Gere as imagens no ChatGPT e importe no editor. A cota Plus compartilhada por API não oferece geração de imagens atualmente.</p><label className="check-label"><input type="checkbox" checked={paid} onChange={e => { if (!e.target.checked || confirm('A API de imagens tem cobrança separada do ChatGPT Plus. Deseja habilitar essa opção?')) setPaid(e.target.checked); }} /> Habilitar geração de imagens pela API paga da OpenAI</label>{paid && <div className="form-row"><label>API key da API Platform<input type="password" autoComplete="new-password" value={imageKey} onChange={e => setImageKey(e.target.value)} placeholder={status.hasImageKey ? 'Chave já protegida no Windows' : 'sk-…'} /></label><label>Modelo de imagem<input value={imageModel} onChange={e => setImageModel(e.target.value)} /></label></div>}<div className="settings-save"><button className="primary" disabled={busy} onClick={() => void action(async () => { const result = await api<{ message: string }>('/api/settings', 'POST', { model, linkedinVersion: version, imageApiEnabled: paid, imageModel, imageKey: imageKey || undefined, linkedinClientId: clientId || undefined, linkedinClientSecret: secret || undefined }); setImageKey(''); setClientId(''); setSecret(''); notify(result.message); })}>{busy ? 'Salvando…' : 'Salvar configurações'}</button></div></section>
      <section className="panel full-width"><h2>Fontes de notícias</h2><p>Blogs oficiais e notas de versão têm prioridade. A coleta lê os últimos sete dias e verifica a página original.</p><div className="feed-list">{feeds.map(feed => <div className="feed" key={feed.id}><label className="check-label"><input type="checkbox" checked={!!feed.enabled} disabled={busy} onChange={e => void action(async () => { await api(`/api/feeds/${feed.id}`, 'PUT', { ...feed, enabled: e.target.checked }); await fetchFeeds(); })} /><span><strong>{feed.name}</strong><small>{feed.url}</small></span></label><label className="feed-priority">Prioridade<select value={feed.priority} disabled={busy} onChange={e => void action(async () => { await api(`/api/feeds/${feed.id}`, 'PUT', { ...feed, enabled: !!feed.enabled, priority: Number(e.target.value) }); await fetchFeeds(); })}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label><button className="danger-text" aria-label={`Remover feed ${feed.name}`} disabled={busy} onClick={() => { if (confirm(`Remover ${feed.name}?`)) void action(async () => { await api(`/api/feeds/${feed.id}`, 'DELETE', {}); await fetchFeeds(); }); }}>Remover</button></div>)}</div><form className="add-feed" onSubmit={e => { e.preventDefault(); void action(async () => { await api('/api/feeds', 'POST', { name: feedName, url: feedUrl, enabled: true, priority: 3 }); setFeedName(''); setFeedUrl(''); await fetchFeeds(); notify('Feed adicionado.'); }); }}><label>Nome<input required value={feedName} onChange={e => setFeedName(e.target.value)} placeholder="Blog oficial" /></label><label>URL do RSS/Atom<input required type="url" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} placeholder="https://…/feed.xml" /></label><button disabled={busy}>Adicionar fonte</button></form></section>
      <section className="panel full-width"><h2>Execução local e backup</h2><p>A geração de rascunhos é iniciada por você, pelo botão <strong>Gerar agora</strong> ou pela CLI.</p><p>Seus dados: <code>{status.dataDir}</code></p><p>Para um backup consistente com mídias, execute <code>node dist/cli.js backup</code>. Consulte o README para restaurar e configurar HTTPS.</p></section>
    </div></>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
