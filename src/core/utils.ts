export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async lock(): Promise<void> {
    if (this.locked) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.locked = true;
  }

  unlock(): void {
    if (this.queue.length > 0) {
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const resolve = this.queue.shift()!;
      resolve();
    } else {
      this.locked = false;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await fn();
    } finally {
      this.unlock();
    }
  }
}
