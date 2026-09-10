import { OpenAIProvider, Runner } from '@openai/agents';

const api = process.env.OPENAI_API_MODE || 'responses';
if (!['responses', 'chat_completions'].includes(api)) throw new Error('Unsupported OPENAI_API_MODE');

// Shared server-side configuration for planning and analysis. No wallet inputs.
export const modelRunner = new Runner({
  model: process.env.OPENAI_MODEL || 'gpt-5.5',
  modelProvider: new OpenAIProvider({
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    useResponses: api === 'responses',
  }),
  modelSettings: { maxTokens: 1200, store: false },
  tracingDisabled: true,
});
