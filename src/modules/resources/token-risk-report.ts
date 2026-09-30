import { z } from 'zod';

export const TokenRiskReportSchema = z.object({
  asset: z.literal('SOL'),
  riskLevel: z.enum(['low', 'medium', 'high']),
  riskScore: z.number().int().min(0).max(100),
  signals: z.array(z.object({
    name: z.string().min(1).max(120),
    status: z.enum(['clear', 'watch', 'alert']),
    detail: z.string().min(1).max(500),
  }).strict()).min(1).max(20),
  summary: z.string().min(1).max(1000),
  generatedAt: z.string().datetime({ offset: true }),
  is_demo_report: z.literal(true),
}).strict();

export const demoTokenRiskReport = TokenRiskReportSchema.parse({
  asset: 'SOL',
  riskLevel: 'medium',
  riskScore: 42,
  signals: [
    { name: 'Liquidity concentration', status: 'watch', detail: 'Deterministic demo signal; no live liquidity was checked.' },
    { name: 'Transfer activity', status: 'clear', detail: 'Deterministic demo signal; no live transfers were checked.' },
  ],
  summary: 'Demo risk report for testing the paid resource delivery path; not a live asset assessment.',
  generatedAt: '2026-09-24T03:00:00.000Z',
  is_demo_report: true,
});
