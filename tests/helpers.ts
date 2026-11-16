import { randomUUID } from 'node:crypto';
import type { Db } from '../src/db.js';

export function seedPost(db: Db, count = 1) {
  const topic = randomUUID(), news = randomUUID(), id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO topics VALUES (?,?,?)').run(topic, `spring-${id}`, 'Spring Boot: atualização prática');
  db.prepare('INSERT INTO news VALUES (?,?,?,?,?,?,?,?,?)').run(news, topic, `https://spring.io/blog/${id}`, `https://spring.io/blog/${id}`, 'Spring Boot: atualização prática', now, 'Conteúdo verificado de teste.', 'Fonte de teste isolada', now);
  db.prepare("INSERT INTO posts(id,topic_id,news_id,generated_text,edited_text,format,status,visual_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'rascunho',?,?,?)").run(id, topic, news, 'Texto original de teste.', 'Uma mudança prática para desenvolver software. Fonte: https://spring.io/', count === 1 ? 'single' : 'gallery', JSON.stringify({ desiredCount: count, visualConcept: 'Uma ilustração editorial sobre desenvolvimento Java.', slides: Array.from({ length: count }, () => ({ purpose: 'Impacto prático', imagePrompt: 'Ilustração editorial de software com blocos azuis, sem texto ou logotipos.', overlayText: '', altText: 'Blocos de software conectados em fundo azul.' })) }), now, now);
  return id;
}
