import { z } from 'zod';

/** Creation only: every executable field comes from a backend-held discovery. */
export const AgentResourceRegistrationInput = z.object({
  discoveryId: z.string().uuid(),
  resourceId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  providerId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
}).strict();

/** Agent-reported evidence is for review, never a proof of spending authority. URLs are not fetched. */
export const ResourceDocumentationSchema = z.object({
  urls: z.array(z.url().max(2048).refine(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  })).max(8),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
}).strict();
