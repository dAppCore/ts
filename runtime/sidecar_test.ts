import { CoreSidecar } from "./sidecar.ts";

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

Deno.test("TestSidecar_healthCheck_Good", async () => {
  const storeSetCalls: Array<[string, string, string]> = [];
  const store = new Map<string, string>();
  let closed = false;
  const client = {
    raw: null,
    ping: async () => ({ ok: true }),
    localeGet: async () => ({ found: false, content: "" }),
    storeGet: async (group: string, key: string) => ({
      value: store.get(`${group}:${key}`) ?? "",
      found: store.has(`${group}:${key}`),
    }),
    storeSet: async (group: string, key: string, value: string) => {
      storeSetCalls.push([group, key, value]);
      store.set(`${group}:${key}`, value);
      return { ok: true };
    },
    fileRead: async () => ({ content: "" }),
    fileWrite: async () => ({ ok: true }),
    fileList: async () => ({ entries: [] }),
    fileDelete: async () => ({ ok: true }),
    processStart: async () => ({ process_id: "proc" }),
    processStop: async () => ({ ok: true }),
    close: () => {
      closed = true;
    },
  };
  const sidecar = new CoreSidecar({ socketPath: "/tmp/core-deno.sock" });
  (sidecar as unknown as { client: typeof client | null }).client = client;

  await sidecar.healthCheck();
  assertEquals(storeSetCalls.length, 1, "healthCheck() should write a probe value");
  assertEquals(
    storeSetCalls[0][0],
    "corets.health",
    "healthCheck() should use the default health group",
  );
  assertEquals(
    sidecar.current(),
    client,
    "current() should expose the connected client",
  );

  sidecar.shutdown();
  assert(closed, "shutdown() should close the underlying client");
  assertEquals(
    sidecar.current(),
    null,
    "shutdown() should clear the current client reference",
  );
});

Deno.test("TestSidecar_healthCheck_Bad", async () => {
  const sidecar = new CoreSidecar({ socketPath: "/tmp/core-deno.sock" });

  let message = "";
  try {
    await sidecar.healthCheck();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(
    message,
    "CoreService client is not connected",
    "healthCheck() should reject when no client is connected",
  );
});

Deno.test("TestSidecar_healthCheck_Ugly", async () => {
  const client = {
    raw: null,
    ping: async () => ({ ok: true }),
    localeGet: async () => ({ found: false, content: "" }),
    storeGet: async () => ({ value: "wrong", found: true }),
    storeSet: async () => ({ ok: true }),
    fileRead: async () => ({ content: "" }),
    fileWrite: async () => ({ ok: true }),
    fileList: async () => ({ entries: [] }),
    fileDelete: async () => ({ ok: true }),
    processStart: async () => ({ process_id: "proc" }),
    processStop: async () => ({ ok: true }),
    close: () => undefined,
  };
  const sidecar = new CoreSidecar({ socketPath: "/tmp/core-deno.sock" });
  (sidecar as unknown as { client: typeof client | null }).client = client;

  let message = "";
  try {
    await sidecar.healthCheck();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(
    message,
    "health check round-trip failed",
    "healthCheck() should fail when the round trip does not match",
  );
});

