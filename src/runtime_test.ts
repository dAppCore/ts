import { injectCoreRuntime } from "./runtime.ts";
import type { CoreStorageBridge } from "./storage.ts";
import type { ElectronBridge } from "./electron.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

Deno.test("injectCoreRuntime composes storage and electron preload surfaces", async () => {
  const storeSets: Array<{ namespace: string; key: string; value: string }> = [];
  const bridge: CoreStorageBridge = {
    store: {
      async get() {
        return null;
      },
      async set(namespace, key, value) {
        storeSets.push({ namespace, key, value });
      },
      async delete() {},
      async list() {
        return [];
      },
      async clear() {},
    },
  };

  const ipcCalls: Array<{ kind: "action" | "query"; channel: string; args: unknown[] }> = [];
  const electronBridge: ElectronBridge = {
    action(channel: string, ...args: unknown[]) {
      ipcCalls.push({ kind: "action", channel, args });
      return undefined;
    },
    query(channel: string, ...args: unknown[]) {
      ipcCalls.push({ kind: "query", channel, args });
      return undefined;
    },
    on() {
      return () => undefined;
    },
    once() {
      return () => undefined;
    },
    off() {},
    offAll() {},
  };

  const wailsBridge = electronBridge;

  const target: Record<string, unknown> = { navigator: {}, document: {} };
  const runtime = injectCoreRuntime({
    origin: "app-demo",
    storage: bridge,
    wails: wailsBridge,
    sessionId: "session-1",
    target,
  });

  assert(runtime.storage !== undefined, "storage polyfills should be injected");
  assert(runtime.electron !== undefined, "electron shim should be injected");
  assert(runtime.wails !== undefined, "wails bridge should be injected");
  await runtime.ready;
  assert(target.localStorage !== undefined, "localStorage should be defined on the target");
  assert(target.sessionStorage !== undefined, "sessionStorage should be defined on the target");
  assert(target.electron !== undefined, "electron should be defined on the target");
  assert(target.wails !== undefined, "wails should be defined on the target");
  assert(target.core !== undefined, "core should be defined on the target");

  (target.localStorage as { setItem(key: string, value: string): void }).setItem(
    "theme",
    "dark",
  );
  await Promise.resolve();

  assertEquals(storeSets.length, 1, "localStorage should write through the store bridge");
  assertEquals(
    storeSets[0].namespace,
    "corets:app-demo:local",
    "localStorage should namespace keys by origin",
  );

  const electron = target.electron as {
    ipcRenderer: { send(channel: string, ...args: unknown[]): unknown };
  };
  electron.ipcRenderer.send("app:ready", { version: "1.0" });

  assertEquals(ipcCalls.length, 1, "electron shim should forward IPC calls");
  assertEquals(ipcCalls[0].kind, "action", "ipcRenderer.send should map to actions");
  assertEquals(ipcCalls[0].channel, "app:ready", "ipcRenderer.send should preserve the channel");
});

Deno.test("injectCoreRuntime forwards an Electron fs bridge", async () => {
  const fsCalls: Array<{ kind: string; path: string; content?: string }> = [];
  const electronBridge: ElectronBridge = {
    action: () => undefined,
    query: () => undefined,
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  };

  const target: Record<string, unknown> = { navigator: {}, document: {} };
  injectCoreRuntime({
    origin: "app-demo",
    electron: electronBridge,
    fs: {
      readFile(path) {
        fsCalls.push({ kind: "readFile", path });
        return path === "/var/demo.txt" ? "file-data" : null;
      },
      writeFile(path, content) {
        fsCalls.push({ kind: "writeFile", path, content });
      },
      deleteFile(path) {
        fsCalls.push({ kind: "deleteFile", path });
      },
      readdir(path) {
        fsCalls.push({ kind: "readdir", path });
        return ["demo.txt"];
      },
      mkdir(path) {
        fsCalls.push({ kind: "mkdir", path });
      },
    },
    target,
  });

  const requireShim = target.require as (module: string) => unknown;
  const fsProxy = requireShim("fs") as {
    readFileSync(path: string): string | null;
    readdirSync(path: string): string[];
  };

  assertEquals(
    fsProxy.readFileSync("/var/demo.txt"),
    "file-data",
    "injectCoreRuntime should expose the configured fs bridge through require('fs')",
  );
  assertEquals(
    fsProxy.readdirSync("/var"),
    ["demo.txt"],
    "injectCoreRuntime should expose the configured fs bridge through require('fs')",
  );
  assertEquals(
    fsCalls[0].kind,
    "readFile",
    "fs bridge should be consulted through the composite injector",
  );
});

Deno.test("injectCoreRuntime reuses the storage filesystem bridge for require('fs')", async () => {
  const fsCalls: Array<{ kind: string; origin: string; path: string; content?: string }> = [];
  const electronBridge: ElectronBridge = {
    action: () => undefined,
    query: () => undefined,
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  };

  const target: Record<string, unknown> = { navigator: {}, document: {} };
  injectCoreRuntime({
    origin: "app-demo",
    electron: electronBridge,
    storage: {
      store: {
        async get() {
          return null;
        },
        async set() {},
        async delete() {},
        async list() {
          return [];
        },
        async clear() {},
      },
      fs: {
        async read(origin, path) {
          fsCalls.push({ kind: "read", origin, path });
          return path === "/var/demo.txt" ? "file-data" : null;
        },
        async write(origin, path, content) {
          fsCalls.push({ kind: "write", origin, path, content });
        },
        async delete(origin, path) {
          fsCalls.push({ kind: "delete", origin, path });
        },
        async list(origin, path) {
          fsCalls.push({ kind: "list", origin, path });
          return ["demo.txt"];
        },
        async mkdir(origin, path) {
          fsCalls.push({ kind: "mkdir", origin, path });
        },
      },
    },
    target,
  });

  const requireShim = target.require as (module: string) => unknown;
  const fsProxy = requireShim("fs") as {
    promises: {
      readFile(path: string): Promise<string | null>;
      readdir(path: string): Promise<string[]>;
    };
  };

  assertEquals(
    await fsProxy.promises.readFile("/var/demo.txt"),
    "file-data",
    "injectCoreRuntime should derive an fs proxy from the storage bridge",
  );
  assertEquals(
    await fsProxy.promises.readdir("/var"),
    ["demo.txt"],
    "injectCoreRuntime should derive directory listing support from the storage bridge",
  );
  assertEquals(fsCalls[0].origin, "app-demo", "derived fs bridge should preserve the origin");
  assertEquals(fsCalls[1].origin, "app-demo", "derived fs bridge should preserve the origin");
});

Deno.test("injectCoreRuntime exposes the Wails bridge without a separate Electron bridge", () => {
  const wailsBridge: ElectronBridge = {
    action: () => undefined,
    query: () => undefined,
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  };

  const target: Record<string, unknown> = { navigator: {}, document: {} };
  const runtime = injectCoreRuntime({
    origin: "app-demo",
    wails: wailsBridge,
    target,
  });

  assert(runtime.electron !== undefined, "Wails-only injection should still build the electron shim");
  assert(runtime.wails === wailsBridge, "Wails-only injection should return the provided bridge");
  assert(target.electron !== undefined, "electron should be injected for Wails-only mode");
  assert(target.wails === wailsBridge, "wails should be injected for Wails-only mode");
});
