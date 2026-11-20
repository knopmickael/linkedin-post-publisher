import type { Media } from './types';

export function MediaPreview({ media, className, card = false }: { media: Pick<Media, 'id' | 'kind'> & Partial<Pick<Media, 'sha256' | 'alt_text'>>; className?: string; card?: boolean }) {
  const src = `/api/media/${media.id}${media.sha256 ? `?v=${media.sha256}` : ''}`;
  return media.kind === 'video'
    ? <video className={className} src={src} controls={!card} preload="metadata" playsInline aria-label={media.alt_text || 'Vídeo da publicação'} />
    : <img className={className} src={src} alt={card ? '' : media.alt_text || (media.kind === 'gif' ? 'GIF da publicação' : 'Imagem da publicação')} />;
}
