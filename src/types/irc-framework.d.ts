declare module 'irc-framework' {
  export class Client {
    constructor();
    connect(options: { host: string; port: number; nick: string; password?: string }): void;
    join(channel: string): void;
    say(target: string, message: string): void;
    on(event: 'registered' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void): this;
    quit(): void;
  }
}
