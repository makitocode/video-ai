import { config } from '@/server/config';
import { AnthropicSummaryProvider } from './anthropic';
import { MockSummaryProvider } from './mock';
import type { SummaryProvider } from './types';

export function getSummaryProvider(): SummaryProvider {
  if (config.summary === 'anthropic' && config.anthropicKey !== undefined) {
    return new AnthropicSummaryProvider(config.anthropicKey, config.anthropicModel);
  }
  return new MockSummaryProvider();
}

export type { SummaryPayload, SummaryProvider } from './types';
