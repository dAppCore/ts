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
  private readonly clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly encoder = new TextEncoder();

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
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // already closed
      }
    }
    this.clients.clear();
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

  handleRequest(request: Request): Response | null {
    const hmrPath = this.options.hmrPath ?? "/_core/hmr";
    const url = new URL(request.url);

    if (request.method !== "GET" || url.pathname !== hmrPath) {
      return null;
    }

    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
        this.clients.add(controller);
        controller.enqueue(this.encoder.encode(": connected\n\n"));
      },
      cancel: () => {
        if (controllerRef) {
          this.clients.delete(controllerRef);
          controllerRef = null;
        }
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
    });
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
        this.broadcast(reloadEvent);
        for (const handler of this.reloadListeners) {
          handler(reloadEvent);
        }

        this.options.onReload?.(reloadEvent);
      }
    } finally {
      this.stop();
    }
  }

  private broadcast(event: DevReloadEvent): void {
    const payload = this.encoder.encode(
      `event: reload\ndata: ${JSON.stringify(event)}\n\n`,
    );
    for (const client of Array.from(this.clients)) {
      try {
        client.enqueue(payload);
      } catch {
        try {
          client.close();
        } catch {
          // already closed
        }
        this.clients.delete(client);
      }
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
