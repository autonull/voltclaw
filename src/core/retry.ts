import { isRetryable } from './errors.js';
import type { RetryConfig } from './types.js';

export class Retrier {
  private readonly config: RetryConfig;

  constructor(config: RetryConfig) {
    this.config = config;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.config.maxAttempts || !isRetryable(error)) {
          throw lastError;
        }

        const delay = this.calculateDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error('Retry failed');
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.config.baseDelayMs * Math.pow(2, attempt - 1),
      this.config.maxDelayMs
    );

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const jitter = this.config.jitterFactor
      ? exponentialDelay * this.config.jitterFactor * (Math.random() * 2 - 1)
      : 0;

    return Math.max(0, exponentialDelay + jitter);
  }
}
