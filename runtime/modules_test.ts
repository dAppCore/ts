import { ModuleRegistry } from "./modules.ts";

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
        this.onmessage?.({ data: { type: "loaded", ok: true } } as MessageEvent);
      });
    }

    terminate(): void {
      this.terminated = true;
    }
  }

  const registry = new ModuleRegistry({
    workerFactory: (scriptUrl, options) =>
      new FakeWorker(scriptUrl, options as { name?: string }) as unknown as Worker,
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
