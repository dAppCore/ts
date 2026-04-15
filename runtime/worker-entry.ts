// Worker bootstrap — loaded as entry point for every module Worker.
// Sets up the I/O bridge (postMessage ↔ parent relay), then dynamically
// imports the module and calls its init(core) function.
//
// The parent (ModuleRegistry) injects module_code into all gRPC calls,
// so modules can't spoof their identity.

// I/O bridge: request/response correlation over postMessage
const pending = new Map<number, { resolve: Function; reject: Function }>();
let nextId = 0;

function rpc(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    self.postMessage({ type: "rpc", id, method, params });
  });
}

// Typed core object passed to module's init() function.
// Each method maps to a CoreService gRPC call relayed through the parent.
const core = {
  storeGet(group: string, key: string) {
    return rpc("StoreGet", { group, key });
  },
  storeSet(group: string, key: string, value: string) {
    return rpc("StoreSet", { group, key, value });
  },
  fileRead(path: string) {
    return rpc("FileRead", { path });
  },
  fileWrite(path: string, content: string) {
    return rpc("FileWrite", { path, content });
  },
  fileList(path: string) {
    return rpc("FileList", { path });
  },
  fileDelete(path: string) {
    return rpc("FileDelete", { path });
  },
  processStart(command: string, args: string[]) {
    return rpc("ProcessStart", { command, args });
  },
  processStop(processId: string) {
    return rpc("ProcessStop", { process_id: processId });
  },
};

// Handle messages from parent: RPC responses and load commands
self.addEventListener("message", async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "rpc_response") {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    }
    return;
  }

  if (msg.type === "load") {
    try {
      const mod = await import(msg.url);
      if (typeof mod.init === "function") {
        await mod.init(core);
      }
      self.postMessage({ type: "loaded", ok: true });
    } catch (err) {
      self.postMessage({
        type: "loaded",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
});

// Signal ready — parent will respond with {type: "load", url: "..."}
self.postMessage({ type: "ready" });
