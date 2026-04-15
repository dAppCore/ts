// CoreDeno Runtime Entry Point
// Connects to CoreGO via gRPC over Unix socket.
// Implements DenoService for module lifecycle management.

// Must be first import — patches http2 before @grpc/grpc-js loads.
import "./polyfill.ts";

import type { CoreClient } from "./client.ts";
import { CoreDevServer } from "./dev.ts";
import { CoreSidecar } from "./sidecar.ts";
import { type DenoServer, startDenoServer } from "./server.ts";
import { ModuleRegistry } from "./modules.ts";
import {
  loadSharedLocale,
  resolvePreferredLocale,
  setLocale,
  setLocaleBridge,
} from "../src/i18n.ts";

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
      onReload: () => {
        void registry.reloadAll().catch((err) => {
          console.error(`CoreDeno: HMR reload failed: ${err}`);
        });
      },
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
  sidecar.shutdown();
  try {
    denoServer?.close();
  } catch {
    // Best-effort cleanup during bootstrap/shutdown failures.
  }
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
const sidecar = new CoreSidecar({
  socketPath: coreSocket,
  logger: console,
});

let coreClient: CoreClient;
try {
  coreClient = await sidecar.connect();
  console.error("CoreDeno: CoreService client connected");
  setLocaleBridge({
    localeGet(locale: string) {
      return coreClient.localeGet(locale);
    },
  });

  const preferredLocale = resolvePreferredLocale({
    CORE_LOCALE: Deno.env.get("CORE_LOCALE") ?? undefined,
    LANG: Deno.env.get("LANG") ?? undefined,
  });
  setLocale(preferredLocale);
  try {
    await loadSharedLocale(preferredLocale, { bridge: coreClient });
  } catch (err) {
    console.error(`CoreDeno: locale preload unavailable: ${err}`);
  }

  try {
    await sidecar.healthCheck();
  } catch (err) {
    console.error(`FATAL: failed CoreService health check: ${err}`);
    shutdownRuntime();
    Deno.exit(1);
  }
} catch (err) {
  console.error(`FATAL: ${err}`);
  stopDevServer();
  denoServer?.close();
  Deno.exit(1);
}

// 4. Inject CoreClient into registry for I/O bridge
registry.setCoreClient(coreClient);

// 5. Signal readiness
console.error("CoreDeno: ready");

// 6. Keep alive until SIGTERM
const shutdownController = new AbortController();
Deno.addSignalListener("SIGTERM", () => {
  console.error("CoreDeno: shutting down");
  shutdownController.abort();
});

try {
  await new Promise((_resolve, reject) => {
    shutdownController.signal.addEventListener(
      "abort",
      () => reject(new Error("shutdown")),
    );
  });
} catch {
  // Clean shutdown
  shutdownRuntime();
}
