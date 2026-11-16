export type Connection = { connected: boolean; label?: string; expiresAt?: number };
export type Status = { openai: Connection; linkedin: Connection; model: string; linkedinVersion: string; imageApiEnabled: boolean; imageModel: string; hasImageKey: boolean; hasLinkedinConfig: boolean; callback: string; dataDir: string; capabilities: Record<string, { status: string; account: string; version: string }>; timezone: string };
export type Summary = { id: string; title: string; edited_text: string; format: 'single' | 'gallery'; status: string; revision: number; thumbnail: string | null; created_at: string; updated_at: string };
export type Media = { id: string; alt_text: string; overlay_text: string; position: number; width: number; height: number; sha256: string };
export type Attempt = { id: string; outcome: string; stage: string; detail?: string; started_at: string };
export type Post = Summary & { generated_text: string; revision: number; approved_revision: number | null; canonical_url: string; published_at: string; evidence: string; published_url: string | null; media: Media[]; attempts: Attempt[]; visual: { visualConcept: string; desiredCount: number; slides: Array<{ purpose: string; imagePrompt: string; overlayText: string; altText: string }> } };
export type Run = { id: string; trigger: string; status: string; stage: string; detail?: string; started_at: string; finished_at?: string; post_id?: string };
export type Feed = { id: number; name: string; url: string; priority: number; enabled: number };
