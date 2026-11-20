import { useEffect, useRef, useState } from 'react';

type Mode = 'news' | 'informative';
export function GenerationDialog({ aiBusy, aiConnected, onCancel, onManual, onGenerate }: {
  aiBusy: boolean; aiConnected: boolean; onCancel: () => void;
  onManual: (subject: string) => Promise<void>; onGenerate: (mode: Mode, subject: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState(''), [busy, setBusy] = useState<string>(), [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement, modal = dialog.current!;
    modal.showModal(); input.current?.focus();
    return () => { modal.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); else document.getElementById('generate-post')?.focus(); };
  }, []);
  async function create(mode: Mode | 'manual') {
    if (busy) return;
    if (mode === 'informative' && !subject.trim()) { setError('Informe o assunto para dissertar.'); input.current?.focus(); return; }
    setError(''); setBusy(mode);
    try {
      if (mode === 'manual') await onManual(subject.trim());
      else await onGenerate(mode, subject.trim());
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar o rascunho.'); }
    finally { setBusy(undefined); }
  }
  const aiDisabled = !!busy || aiBusy || !aiConnected;
  return <dialog ref={dialog} className="generation-dialog" aria-labelledby="generation-title" aria-describedby="generation-description" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dialog-heading"><div><div className="eyebrow">DO SEU JEITO</div><h2 id="generation-title">Nova publicação</h2></div><button type="button" className="dialog-close" aria-label="Fechar modal" disabled={!!busy} onClick={onCancel}>×</button></div>
    <p id="generation-description">Uma notícia, sua própria ideia ou um assunto para explorar. Escolha como começar.</p>
    <form onSubmit={e => { e.preventDefault(); if (!aiDisabled) void create('news'); }}>
      <label htmlFor="generation-subject">Assunto da publicação</label>
      <input ref={input} id="generation-subject" value={subject} maxLength={500} disabled={!!busy} onChange={e => setSubject(e.target.value)} placeholder="Ex.: Kubernetes, segurança na nuvem…" aria-describedby="generation-subject-help generation-feedback" aria-invalid={!!error && !subject.trim()} />
      <p id="generation-subject-help" className="muted">Usado pelas opções com IA. Para notícias, é opcional: sem assunto, priorizamos notícias de tecnologia, novas vulnerabilidades e correções. Para dissertar, informe um assunto.</p>
      <div id="generation-feedback" aria-live="polite">{error && <p className="dialog-error" role="alert">{error}</p>}{!aiConnected ? <p className="muted">Conecte o ChatGPT nas configurações para usar IA. A opção Manual já está disponível.</p> : aiBusy ? <p className="muted">Há uma geração em andamento. Você pode criar uma publicação manual enquanto aguarda.</p> : null}</div>
      <div className="generation-options">
        <button type="submit" aria-label="Gerar notícia (IA)" disabled={aiDisabled}><span className="option-icon" aria-hidden="true">✦</span><strong>{busy === 'news' ? 'Iniciando…' : 'Gerar notícia (IA)'}</strong><span>Uma notícia recente, com fonte e sua perspectiva.</span></button>
        <button type="button" aria-label="Manual" disabled={!!busy} onClick={() => void create('manual')}><span className="option-icon" aria-hidden="true">✎</span><strong>{busy === 'manual' ? 'Criando…' : 'Manual'}</strong><span>Rascunho imediato para você escrever do seu jeito.</span></button>
        <button type="button" aria-label="Dissertar (IA)" disabled={aiDisabled} onClick={() => void create('informative')}><span className="option-icon" aria-hidden="true">≡</span><strong>{busy === 'informative' ? 'Iniciando…' : 'Dissertar (IA)'}</strong><span>Conteúdo informativo para explicar o assunto.</span></button>
      </div>
      <p className="generation-note">As opções com IA incluem três sugestões de hashtags no texto.</p>
    </form>
  </dialog>;
}
