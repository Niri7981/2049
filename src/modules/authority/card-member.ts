import { z } from 'zod';

export const CardMemberSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  status: z.enum(['ACTIVE', 'REVOKED']),
  createdAt: z.number().int().nonnegative().safe(),
  updatedAt: z.number().int().nonnegative().safe(),
}).strict();

export type CardMember = z.infer<typeof CardMemberSchema>;
