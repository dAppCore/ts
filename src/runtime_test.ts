import { injectCoreRuntime } from "./runtime.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("injectCoreRuntime composes storage and Electron preload shims", () => {
  const target: Record<string, unknown> = { navigator: {}, document: {} };
  const runtime = injectCoreRuntime({
    origin: "https://example.com",
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
    },
    electron: {
      action: () => undefined,
      query: () => undefined,
      on: () => () => undefined,
      once: () => () => undefined,
      off: () => undefined,
      offAll: () => undefined,
    },
    target,
  });

  assert(runtime.storage !== undefined, "storage polyfills should be injected");
  assert(runtime.electron !== undefined, "electron shim should be injected");
  assert(typeof target.localStorage === "object", "localStorage should be exposed");
  assert(typeof target.electron === "object", "electron shim should be exposed");
  assert(typeof target.require === "function", "require shim should be exposed");
});
