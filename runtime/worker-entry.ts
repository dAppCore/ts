// Worker bootstrap — loaded as entry point for every module Worker.
// Sets up the I/O bridge (postMessage ↔ parent relay), then dynamically
// imports the module and calls its init(core) function.
//
// The parent (ModuleRegistry) injects module_code into all gRPC calls,
// so modules can't spoof their identity.

import { type RuntimeIPCMessage, RuntimeRPCClient } from "./ipc.ts";

const workerScope = globalThis as unknown as {
  postMessage(message: RuntimeIPCMessage): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<RuntimeIPCMessage>) => void | Promise<void>,
  ): void;
};

const channel = {
  post(message: RuntimeIPCMessage): void {
    workerScope.postMessage(message);
  },
};

const rpcClient = new RuntimeRPCClient(channel);
const core = rpcClient.createCoreBridge();

// Handle messages from parent: RPC responses and load commands
workerScope.addEventListener(
  "message",
  async (e: MessageEvent<RuntimeIPCMessage>) => {
    const msg = e.data as RuntimeIPCMessage;

    if (rpcClient.handle(msg)) {
      return;
    }

    if (msg.type === "load") {
      try {
        const mod = await import(msg.url);
        if (typeof mod.init === "function") {
          await mod.init(core);
        }
        workerScope.postMessage({ type: "loaded", ok: true });
      } catch (err) {
        workerScope.postMessage({
          type: "loaded",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
  },
);

// Signal ready — parent will respond with {type: "load", url: "..."}
workerScope.postMessage({ type: "ready" });
