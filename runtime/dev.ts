export interface DevReloadEvent {
  kind: "create" | "modify" | "remove" | "other";
  paths: string[];
  timestamp: number;
}

export interface DevServerOptions {
  root: string;
  hmrPath?: string;
  onReload?: (event: DevReloadEvent) => void;
}

export class CoreDevServer extends EventTarget {
  private watcher: Deno.FsWatcher | null = null;
  private readonly reloadListeners = new Set<(event: DevReloadEvent) => void>();

  constructor(private readonly options: DevServerOptions) {
    super();
  }

  async start(): Promise<void> {
    if (this.watcher) {
      return;
    }

    if (typeof Deno === "undefined" || typeof Deno.watchFs !== "function") {
      throw new Error("file watching is not available in this runtime");
    }

    this.watcher = Deno.watchFs(this.options.root);
    void this.consume();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  subscribe(handler: (event: DevReloadEvent) => void): () => void {
    this.reloadListeners.add(handler);
    return () => this.reloadListeners.delete(handler);
  }

  snapshot(): {
    active: boolean;
    hmrPath: string;
    root: string;
    subscribers: number;
  } {
    return {
      active: this.watcher !== null,
      hmrPath: this.options.hmrPath ?? "/_core/hmr",
      root: this.options.root,
      subscribers: this.reloadListeners.size,
    };
  }

  hmrScript(): string {
    return createHmrClientScript(this.options.hmrPath ?? "/_core/hmr");
  }

  private async consume(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    try {
      for await (const event of this.watcher) {
        const reloadEvent = normaliseReloadEvent(event);
        const customEvent = new CustomEvent<DevReloadEvent>("reload", {
          detail: reloadEvent,
        });

        this.dispatchEvent(customEvent);
        for (const handler of this.reloadListeners) {
          handler(reloadEvent);
        }

        this.options.onReload?.(reloadEvent);
      }
    } finally {
      this.stop();
    }
  }
}

export function createHmrClientScript(endpoint = "/_core/hmr"): string {
  const safeEndpoint = JSON.stringify(endpoint);
  return `(() => {
  const endpoint = ${safeEndpoint};
  let retry = 250;

  const connect = () => {
    const stream = new EventSource(endpoint);

    stream.addEventListener("reload", () => {
      stream.close();
      window.location.reload();
    });

    stream.addEventListener("error", () => {
      stream.close();
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 4000);
    });
  };

  connect();
})();`;
}

function normaliseReloadEvent(event: Deno.FsEvent): DevReloadEvent {
  return {
    kind: event.kind === "create" || event.kind === "modify" || event.kind === "remove"
      ? event.kind
      : "other",
    paths: [...event.paths],
    timestamp: Date.now(),
  };
}

export async function startDevServer(options: DevServerOptions): Promise<CoreDevServer> {
  const server = new CoreDevServer(options);
  await server.start();
  return server;
}
