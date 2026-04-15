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

  const target: Record<string, unknown> = { navigator: {}, document: {} };
  const runtime = injectCoreRuntime({
    origin: "app-demo",
    storage: bridge,
    electron: electronBridge,
    sessionId: "session-1",
    target,
  });

  assert(runtime.storage !== undefined, "storage polyfills should be injected");
  assert(runtime.electron !== undefined, "electron shim should be injected");
  assert(target.localStorage !== undefined, "localStorage should be defined on the target");
  assert(target.sessionStorage !== undefined, "sessionStorage should be defined on the target");
  assert(target.electron !== undefined, "electron should be defined on the target");
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
