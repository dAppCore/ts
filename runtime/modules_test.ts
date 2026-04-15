import { ModuleRegistry } from "./modules.ts";
import { join } from "node:path";

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

Deno.test("ModuleRegistry.reloadAll reloads active modules only", async () => {
  const createdWorkers: string[] = [];

  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;

    constructor(
      _url: string,
      options: { name?: string },
    ) {
      createdWorkers.push(options.name ?? "");
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: "ready" } } as MessageEvent);
      });
    }

    postMessage(message: { type?: string }): void {
      if (message.type !== "load") {
        return;
      }

      queueMicrotask(() => {
        this.onmessage?.(
          { data: { type: "loaded", ok: true } } as MessageEvent,
        );
      });
    }

    terminate(): void {
      this.terminated = true;
    }
  }

  const registry = new ModuleRegistry({
    workerFactory: (scriptUrl, options) =>
      new FakeWorker(
        scriptUrl,
        options as { name?: string },
      ) as unknown as Worker,
  });

  const first = await registry.load("alpha", "file:///tmp/alpha.ts", {
    read: ["./alpha/"],
  });
  const second = await registry.load("beta", "file:///tmp/beta.ts", {
    read: ["./beta/"],
  });

  assert(first.ok, "first module should load");
  assert(second.ok, "second module should load");

  registry.unload("beta");

  const reloadResults = await registry.reloadAll();

  assertEquals(reloadResults.length, 1, "only active modules should reload");
  assertEquals(
    createdWorkers.filter((code) => code === "alpha").length,
    2,
    "active module should be reloaded",
  );
  assertEquals(
    createdWorkers.filter((code) => code === "beta").length,
    1,
    "stopped module should not be reloaded",
  );
  assertEquals(
    registry.status("alpha"),
    "RUNNING",
    "active module should remain running after reload",
  );
  assertEquals(
    registry.status("beta"),
    "STOPPED",
    "stopped module should remain stopped after reload",
  );
});

Deno.test("ModuleRegistry_ModuleIsolation_Bad", async () => {
  const registry = new ModuleRegistry();
  const store = new Map<string, string>();
  registry.setCoreClient(createMemoryCoreClient(store));

  const tempRoot = await Deno.makeTempDir();
  const moduleADir = join(tempRoot, "module-a");
  const moduleBDir = join(tempRoot, "module-b");
  await Deno.mkdir(moduleADir, { recursive: true });
  await Deno.mkdir(moduleBDir, { recursive: true });
  await Deno.writeTextFile(
    join(moduleADir, "main.ts"),
    `
      export async function init() {
        await import(new URL("../module-b/secret.ts", import.meta.url).href);
      }
    `,
  );
  await Deno.writeTextFile(
    join(moduleBDir, "secret.ts"),
    `export const SECRET = "cross-module-import";`,
  );

  try {
    const result = await registry.load(
      "module-a",
      join(moduleADir, "main.ts"),
      {
        read: [moduleADir],
      },
    );

    assert(
      !result.ok,
      "module load should fail when it imports outside its root",
    );
    const blockedMessage = result.error ?? "";
    assert(
      blockedMessage.includes("module isolation violation") ||
        isPermissionError(blockedMessage),
      "cross-module imports should be blocked before the worker starts or by the worker sandbox",
    );
  } finally {
    await Deno.remove(tempRoot, { recursive: true });
  }
});

Deno.test("ModuleRegistry_ModuleIsolation_Good", async () => {
  const registry = new ModuleRegistry();
  const store = new Map<string, string>();
  registry.setCoreClient(createMemoryCoreClient(store));

  const writer = await registry.load(
    "writer",
    fixturePath("ipc-writer-module.ts"),
    {
      read: [fixturePath("")],
    },
  );
  const reader = await registry.load(
    "reader",
    fixturePath("ipc-reader-module.ts"),
    {
      read: [fixturePath("")],
    },
  );

  assert(writer.ok, "writer module should load");
  assert(reader.ok, "reader module should load");
  assertEquals(
    store.get("module-isolation:ipc-observed"),
    "hello-through-ipc",
    "modules should communicate through the IPC relay",
  );
});

function fixturePath(relativePath: string): string {
  return join(Deno.cwd(), "runtime", "testdata", relativePath);
}

function isPermissionError(message: string): boolean {
  return message.includes("PermissionDenied") ||
    message.includes("NotCapable") ||
    message.includes("Requires read access");
}

function createMemoryCoreClient(store: Map<string, string>) {
  return {
    raw: null,
    ping: async () => ({ ok: true }),
    localeGet: async () => ({ found: false, content: "" }),
    storeGet: async (group: string, key: string) => ({
      value: store.get(`${group}:${key}`) ?? "",
      found: store.has(`${group}:${key}`),
    }),
    storeSet: async (group: string, key: string, value: string) => {
      store.set(`${group}:${key}`, value);
      return { ok: true };
    },
    fileRead: async () => ({ content: "" }),
    fileWrite: async () => ({ ok: true }),
    fileList: async () => ({ entries: [] }),
    fileDelete: async () => ({ ok: true }),
    processStart: async () => ({ process_id: "proc" }),
    processStop: async () => ({ ok: true }),
    close: () => undefined,
  };
}
