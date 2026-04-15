import { type CoreClient, createCoreClient } from "./client.ts";

export interface CoreSidecarLogger {
  error(message: string): void;
}

export interface CoreSidecarOptions {
  socketPath: string;
  maxRetries?: number;
  retryDelayMs?: number;
  pingTimeoutMs?: number;
  logger?: CoreSidecarLogger;
  healthGroup?: string;
  healthKey?: string;
}

export class CoreSidecar {
  private client: CoreClient | null = null;

  constructor(private readonly options: CoreSidecarOptions) {}

  current(): CoreClient | null {
    return this.client;
  }

  async connect(): Promise<CoreClient> {
    this.shutdown();

    const client = createCoreClient(this.options.socketPath);
    const maxRetries = this.options.maxRetries ?? 20;
    const retryDelayMs = this.options.retryDelayMs ?? 250;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.timeout(client.ping());
        if (response.ok) {
          this.client = client;
          return client;
        }
        lastError = new Error("ping returned not ok");
      } catch (error) {
        lastError = error;
        if (attempt < 3 || attempt === 9 || attempt === maxRetries - 1) {
          this.options.logger?.error(`CoreDeno: retry ${attempt}: ${error}`);
        }
      }

      await delay(retryDelayMs);
    }

    client.close();
    throw new Error(
      `failed to connect to CoreService after retries, last error: ${lastError}`,
    );
  }

  async reconnect(): Promise<CoreClient> {
    return await this.connect();
  }

  async healthCheck(): Promise<void> {
    const client = this.requireClient();
    const healthGroup = this.options.healthGroup ?? "corets.health";
    const healthKey = this.options.healthKey ?? "startup";
    const healthValue = `ok:${Date.now()}`;

    await client.storeSet(healthGroup, healthKey, healthValue);
    const roundTrip = await client.storeGet(healthGroup, healthKey);
    if (!roundTrip.found || roundTrip.value !== healthValue) {
      throw new Error("health check round-trip failed");
    }
  }

  shutdown(): void {
    try {
      this.client?.close();
    } catch {
      // Best-effort cleanup on shutdown.
    } finally {
      this.client = null;
    }
  }

  private requireClient(): CoreClient {
    if (!this.client) {
      throw new Error("CoreService client is not connected");
    }
    return this.client;
  }

  private async timeout<T>(promise: Promise<T>): Promise<T> {
    const timeoutMs = this.options.pingTimeoutMs ?? 2000;
    return await Promise.race([
      promise,
      delay(timeoutMs).then(() => {
        throw new Error("call timeout");
      }),
    ]);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
