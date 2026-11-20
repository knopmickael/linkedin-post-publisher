import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { lease, setting, setSetting } from './db.js';
import type { Auth } from './auth.js';
import { AppError, message } from './errors.js';
import { getPost, snapshot } from './posts.js';
import { fileHash, mediaPath } from './media.js';
import { uploadAsset, waitForVideo } from './linkedin-media.js';

export function linkedinBody(author: string, text: string, images: Array<{ id: string; altText: string }>) {
  return {
    author, commentary: text.replace(/([\\{}@\[\]()<>#*_~|])/g, '\\$1'), visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(images.length ? { content: images.length === 1 ? { media: images[0].id.startsWith('urn:li:video:') ? { id: images[0].id } : images[0] } : { multiImage: { images } } } : {}),
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
  };
}
export function publicationOutcome(status?: number) { return status !== undefined && status >= 400 && status < 500 && status !== 408 ? 'failed' : 'unknown'; }

export async function publish(db: Db, auth: Auth, dataDir: string, postId: string, revision: number) {
  const lock = lease(db, `publish:${postId}`, 120); const attemptId = randomUUID(); let creating = false;
  const heartbeat = setInterval(() => { try { lock.renew(); } catch { /* Verified before creation. */ } }, 30000);
  try {
    const token = await auth.access('linkedin'); const post = getPost(db, postId);
    if (post.status !== 'aprovado' || post.approved_revision !== revision || post.revision !== revision) throw new AppError('Aprove a revisão atual antes de publicar.', 409);
    for (const media of post.media) {
      if (await fileHash(mediaPath(dataDir, media.path)) !== media.sha256) throw new AppError('Arquivo mudou após a aprovação. Importe a mídia novamente.');
    }
    db.transaction(() => {
      const current = getPost(db, postId);
      if (current.status !== 'aprovado' || current.revision !== revision || current.approved_revision !== revision) throw new AppError('Revisão mudou. Atualize o editor.', 409);
      db.prepare('INSERT INTO attempts(id,post_id,revision,snapshot,stage,outcome,started_at) VALUES (?,?,?,?,?,?,?)').run(attemptId, postId, revision, snapshot(db, postId), 'uploading', 'active', new Date().toISOString());
      db.prepare("UPDATE posts SET status='publicando',updated_at=? WHERE id=?").run(new Date().toISOString(), postId);
    })();
    const headers = { Authorization: `Bearer ${token.access_token}`, 'LinkedIn-Version': setting(db, 'linkedinVersion', '202610'), 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
    const author = `urn:li:person:${token.subject}`; const images: Array<{ id: string; altText: string }> = [];
    for (const media of post.media) {
      lock.renew();
      // Reuse successful uploads of this exact immutable media from previous attempts.
      const reused = db.prepare("SELECT u.asset_urn FROM uploads u JOIN attempts a ON a.id=u.attempt_id WHERE u.media_id=? AND u.status='uploaded' AND a.post_id=? AND a.revision=? ORDER BY a.started_at DESC LIMIT 1").get(media.id, postId, revision) as { asset_urn: string } | undefined;
      let urn = reused?.asset_urn;
      if (!urn) {
        const uploadId = randomUUID();
        urn = await uploadAsset(headers, author, media, dataDir, assetUrn => {
          db.prepare('INSERT INTO uploads VALUES (?,?,?,?,?)').run(uploadId, attemptId, media.id, assetUrn, 'initialized');
        }, lock.renew);
        db.prepare("UPDATE uploads SET status='uploaded' WHERE id=?").run(uploadId);
      }
      if (media.kind === 'video') await waitForVideo(headers, urn, lock.renew);
      images.push({ id: urn, altText: media.alt_text });
    }
    // w_member_social may not permit polling /rest/images: do not require a forbidden GET.
    // A definite media-not-ready error leaves the approved revision reusable after review.
    lock.renew();
    db.prepare("UPDATE attempts SET stage='creating' WHERE id=?").run(attemptId); creating = true;
    const response = await fetch('https://api.linkedin.com/rest/posts', { method: 'POST', headers, body: JSON.stringify(linkedinBody(author, post.edited_text, images)), signal: AbortSignal.timeout(45000), redirect: 'error' });
    const urn = response.headers.get('x-restli-id');
    if (!response.ok || response.status !== 201 || !urn) {
      const outcome = publicationOutcome(response.status);
      const detail = outcome === 'unknown' ? 'Resultado incerto. Confira seu perfil no LinkedIn antes de tentar novamente.' : `LinkedIn recusou a criação (HTTP ${response.status}). Confira permissões, formato e processamento das imagens. Se for mídia ainda processando, aguarde antes de aprovar e tentar novamente.`;
      db.prepare('UPDATE attempts SET outcome=?,http_status=?,detail=?,finished_at=? WHERE id=?').run(outcome, response.status, detail, new Date().toISOString(), attemptId);
      throw new AppError(detail, 409, outcome);
    }
    const publishedUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;
    db.transaction(() => {
      db.prepare("UPDATE attempts SET stage='completed',outcome='success',http_status=201,linkedin_urn=?,finished_at=? WHERE id=?").run(urn, new Date().toISOString(), attemptId);
      db.prepare("UPDATE posts SET status='publicado',linkedin_urn=?,published_url=?,updated_at=? WHERE id=?").run(urn, publishedUrl, new Date().toISOString(), postId);
      const capabilities = setting<Record<string, unknown>>(db, 'linkedinCapabilities', {});
      capabilities[post.format] = { status: 'validado', account: token.subject, version: headers['LinkedIn-Version'], at: new Date().toISOString() }; setSetting(db, 'linkedinCapabilities', capabilities);
    })();
    return { publishedUrl, urn };
  } catch (error) {
    db.transaction(() => {
      const row = db.prepare('SELECT outcome FROM attempts WHERE id=?').get(attemptId) as { outcome: string } | undefined;
      if (row?.outcome === 'active') db.prepare('UPDATE attempts SET outcome=?,detail=?,finished_at=? WHERE id=?').run(creating ? 'unknown' : 'failed', creating ? 'Resultado incerto após envio. Verifique no LinkedIn antes de repetir.' : message(error), new Date().toISOString(), attemptId);
      if (row) db.prepare("UPDATE posts SET status='falha',updated_at=? WHERE id=? AND status='publicando'").run(new Date().toISOString(), postId);
    })();
    throw error;
  } finally { clearInterval(heartbeat); lock.release(); }
}
