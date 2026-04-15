export type CoreEventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface CoreEventBridge<TEvents extends Record<string, unknown> = Record<string, unknown>> {
  on<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): () => void;
  once<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): () => void;
  off<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): void;
  offAll(event?: string): void;
  removeAllListeners(event?: string): void;
  emit<K extends keyof TEvents & string>(
    event: K,
    payload: TEvents[K],
  ): Promise<void>;
}

export class CoreEventBus<
  TEvents extends Record<string, unknown> = Record<string, unknown>,
> implements CoreEventBridge<TEvents> {
  private readonly listeners = new Map<string, Set<CoreEventHandler<unknown>>>();

  on<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): () => void {
    const set = this.bucket(event);
    set.add(handler as CoreEventHandler<unknown>);
    return () => this.off(event, handler);
  }

  once<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): () => void {
    const wrapped: CoreEventHandler<TEvents[K]> = async (payload) => {
      this.off(event, wrapped);
      await handler(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    set.delete(handler as CoreEventHandler<unknown>);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  offAll(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.clear();
  }

  removeAllListeners(event?: string): void {
    this.offAll(event);
  }

  async emit<K extends keyof TEvents & string>(
    event: K,
    payload: TEvents[K],
  ): Promise<void> {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      return;
    }

    for (const handler of Array.from(set)) {
      await handler(payload);
    }
  }

  listenerCount(event?: string): number {
    if (event) {
      return this.listeners.get(event)?.size ?? 0;
    }
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [event, set] of this.listeners) {
      out[event] = set.size;
    }
    return out;
  }

  private bucket(event: string): Set<CoreEventHandler<unknown>> {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    return set;
  }
}
