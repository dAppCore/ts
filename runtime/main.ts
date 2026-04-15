// CoreDeno Runtime Entry Point
// Connects to CoreGO via gRPC over Unix socket.
// Implements DenoService for module lifecycle management.

// Must be first import — patches http2 before @grpc/grpc-js loads.
import "./polyfill.ts";

import { createCoreClient, type CoreClient } from "./client.ts";
import { startDenoServer, type DenoServer } from "./server.ts";
import { ModuleRegistry } from "./modules.ts";

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

// 2. Start DenoService server (Go calls us here via JSON-RPC over Unix socket)
let denoServer: DenoServer;
try {
  denoServer = await startDenoServer(denoSocket, registry);
  console.error("CoreDeno: DenoService server started");
} catch (err) {
  console.error(`FATAL: failed to start DenoService server: ${err}`);
  Deno.exit(1);
}

// 3. Connect to CoreService (we call Go here) with retry
let coreClient: CoreClient;
{
  coreClient = createCoreClient(coreSocket);
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
      const resp = await timeoutCall(coreClient.ping());
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
    denoServer.close();
    Deno.exit(1);
  }
  console.error("CoreDeno: CoreService client connected");
}

// 4. Inject CoreClient into registry for I/O bridge
registry.setCoreClient(coreClient);

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
  coreClient.close();
  denoServer.close();
}
