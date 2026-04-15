export type CoreEventHandler<T = unknown> = (
  payload: T,
) => void | Promise<void>;

export interface CoreEventBridge<
  TEvents extends Record<string, unknown> = Record<string, unknown>,
> {
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

export interface WailsEventSource<
  TEvents extends Record<string, unknown> = Record<string, unknown>,
> {
  On<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): (() => void) | void;
  Off?<K extends keyof TEvents & string>(
    event: K,
    handler: CoreEventHandler<TEvents[K]>,
  ): void;
  OffAll?(event?: string): void;
  Emit?<K extends keyof TEvents & string>(
    event: K,
    payload: TEvents[K],
  ): Promise<void> | void;
}

export interface CoreWailsEventBridge<
  TEvents extends Record<string, unknown> = Record<string, unknown>,
> extends CoreEventBridge<TEvents> {
  readonly bus: CoreEventBus<TEvents>;
  dispose(): void;
}

export class CoreEventBus<
  TEvents extends Record<string, unknown> = Record<string, unknown>,
> implements CoreEventBridge<TEvents> {
  private readonly listeners = new Map<
    string,
    Set<CoreEventHandler<unknown>>
  >();

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

// Example:
//   const events = createWailsEventBridge(Events);
//   events.on("agent.completed", (payload) => console.log(payload));
//
// Adapts the Wails `Events.On/Off/Emit` shape to the Core event bridge so
// browser code can use the same predictable API as the rest of CoreTS.
export function createWailsEventBridge<
  TEvents extends Record<string, unknown> = Record<string, unknown>,
>(
  source: WailsEventSource<TEvents>,
  bus = new CoreEventBus<TEvents>(),
): CoreWailsEventBridge<TEvents> {
  const sourceHandlers = new Map<string, CoreEventHandler<unknown>>();
  const sourceDisposers = new Map<string, () => void>();

  const ensureSourceSubscription = <K extends keyof TEvents & string>(
    event: K,
  ): void => {
    if (sourceHandlers.has(event)) {
      return;
    }

    const handler: CoreEventHandler<TEvents[K]> = (payload) =>
      bus.emit(event, payload);
    sourceHandlers.set(event, handler as CoreEventHandler<unknown>);

    const dispose = source.On(event, handler);
    if (typeof dispose === "function") {
      sourceDisposers.set(event, dispose);
    }
  };

  const clearSourceSubscription = (event: string): void => {
    const dispose = sourceDisposers.get(event);
    if (dispose) {
      dispose();
    } else {
      const handler = sourceHandlers.get(event);
      if (handler && source.Off) {
        source.Off(
          event,
          handler as CoreEventHandler<TEvents[keyof TEvents & string]>,
        );
      }
    }
    sourceDisposers.delete(event);
    sourceHandlers.delete(event);
  };

  const maybeReleaseSourceSubscription = (event: string): void => {
    if (bus.listenerCount(event) === 0) {
      clearSourceSubscription(event);
    }
  };

  const offAll = (event?: string): void => {
    if (event) {
      bus.offAll(event);
      clearSourceSubscription(event);
      return;
    }

    bus.offAll();
    for (const name of Array.from(sourceHandlers.keys())) {
      clearSourceSubscription(name);
    }
  };

  return {
    bus,
    on<K extends keyof TEvents & string>(
      event: K,
      handler: CoreEventHandler<TEvents[K]>,
    ): () => void {
      ensureSourceSubscription(event);
      const off = bus.on(event, handler);
      return () => {
        off();
        maybeReleaseSourceSubscription(event);
      };
    },
    once<K extends keyof TEvents & string>(
      event: K,
      handler: CoreEventHandler<TEvents[K]>,
    ): () => void {
      ensureSourceSubscription(event);
      const off = bus.once(event, handler);
      return () => {
        off();
        maybeReleaseSourceSubscription(event);
      };
    },
    off<K extends keyof TEvents & string>(
      event: K,
      handler: CoreEventHandler<TEvents[K]>,
    ): void {
      bus.off(event, handler);
      maybeReleaseSourceSubscription(event);
    },
    offAll,
    removeAllListeners(event?: string): void {
      offAll(event);
    },
    async emit<K extends keyof TEvents & string>(
      event: K,
      payload: TEvents[K],
    ): Promise<void> {
      await bus.emit(event, payload);
      await source.Emit?.(event, payload);
    },
    dispose(): void {
      offAll();
    },
  };
}
