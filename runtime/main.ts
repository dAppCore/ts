// CoreDeno Runtime Entry Point
// Connects to CoreGO via gRPC over Unix socket.
// Implements DenoService for module lifecycle management.

// Must be first import — patches http2 before @grpc/grpc-js loads.
import "./polyfill.ts";

import { createCoreClient, type CoreClient } from "./client.ts";
import { CoreDevServer } from "./dev.ts";
import { startDenoServer, type DenoServer } from "./server.ts";
import { ModuleRegistry } from "./modules.ts";
import { setLocaleBridge } from "../src/i18n.ts";

// Read required environment variables
const coreSocket = Deno.env.get("CORE_SOCKET");
if (!coreSocket) {
  console.error("FATAL: CORE_SOCKET environment variable not set");
  Deno.exit(1);
}

const denoSocket = Deno.env.get("DENO_SOCKET");
if (!denoSocket) {
  console.error("FATAL: DENO_SOCKET environment variable not set");
  Deno.exit(1);
}

console.error(`CoreDeno: CORE_SOCKET=${coreSocket}`);
console.error(`CoreDeno: DENO_SOCKET=${denoSocket}`);

// 1. Create module registry
const registry = new ModuleRegistry();

// Optional dev server: watch source trees and trigger HMR reload hooks.
let devServer: CoreDevServer | null = null;
const devRoot = Deno.env.get("CORE_DEV_ROOT");
if (devRoot) {
  try {
    devServer = new CoreDevServer({
      root: devRoot,
      hmrPath: Deno.env.get("CORE_HMR_PATH") ?? "/_core/hmr",
    });
    await devServer.start();
    console.error(`CoreDeno: dev server watching ${devRoot}`);
  } catch (err) {
    console.error(`CoreDeno: dev server unavailable: ${err}`);
  }
}

function stopDevServer(): void {
  try {
    devServer?.stop();
  } catch {
    // Best-effort cleanup during bootstrap/shutdown failures.
  }
}

function shutdownRuntime(): void {
  stopDevServer();
  try {
    coreClient?.close();
  } catch {
    // Best-effort cleanup during bootstrap/shutdown failures.
  }
  try {
    denoServer?.close();
  } catch {
    // Best-effort cleanup during bootstrap/shutdown failures.
  }
  coreClient = null;
  denoServer = null;
}

// 2. Start DenoService server (Go calls us here via JSON-RPC over Unix socket)
let denoServer: DenoServer | null = null;
try {
  denoServer = await startDenoServer(denoSocket, registry);
  console.error("CoreDeno: DenoService server started");
} catch (err) {
  console.error(`FATAL: failed to start DenoService server: ${err}`);
  stopDevServer();
  Deno.exit(1);
}

// 3. Connect to CoreService (we call Go here) with retry
let coreClient: CoreClient | null = null;
{
  const runtimeClient = createCoreClient(coreSocket);
  coreClient = runtimeClient;
  const maxRetries = 20;
  let connected = false;
  let lastErr: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const timeoutCall = <T>(p: Promise<T>): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error("call timeout")), 2000),
          ),
        ]);
      const resp = await timeoutCall(runtimeClient.ping());
      if (resp.ok) {
        connected = true;
        break;
      }
    } catch (err) {
      lastErr = err;
      if (i < 3 || i === 9 || i === 19) {
        console.error(`CoreDeno: retry ${i}: ${err}`);
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!connected) {
    console.error(
      `FATAL: failed to connect to CoreService after retries, last error: ${lastErr}`,
    );
    stopDevServer();
    denoServer?.close();
    Deno.exit(1);
  }
  console.error("CoreDeno: CoreService client connected");
  setLocaleBridge({
    localeGet(locale: string) {
      return runtimeClient.localeGet(locale);
    },
  });

  // Verify store round-trip so the bootstrap checks both transport and I/O.
  const healthGroup = "corets.health";
  const healthKey = "startup";
  const healthValue = `ok:${Date.now()}`;
  try {
    await runtimeClient.storeSet(healthGroup, healthKey, healthValue);
    const roundTrip = await runtimeClient.storeGet(healthGroup, healthKey);
    if (!roundTrip.found || roundTrip.value !== healthValue) {
      throw new Error("health check round-trip failed");
    }
  } catch (err) {
    console.error(`FATAL: failed CoreService health check: ${err}`);
    shutdownRuntime();
    Deno.exit(1);
  }
}

// 4. Inject CoreClient into registry for I/O bridge
registry.setCoreClient(coreClient!);

// 5. Signal readiness
console.error("CoreDeno: ready");

// 6. Keep alive until SIGTERM
const ac = new AbortController();
Deno.addSignalListener("SIGTERM", () => {
  console.error("CoreDeno: shutting down");
  ac.abort();
});

try {
  await new Promise((_resolve, reject) => {
    ac.signal.addEventListener("abort", () => reject(new Error("shutdown")));
  });
} catch {
  // Clean shutdown
  shutdownRuntime();
}
