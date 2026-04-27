import { createCoreClient } from "./client.ts";

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

Deno.test("TestClient_createCoreClient_Good", async () => {
  const client = createCoreClient("/tmp/core-deno.sock");
  const calls: Array<{ method: string; request: unknown }> = [];
  let closed = false;
  const raw = client.raw as Record<
    string,
    (request: unknown, callback: (error: Error | null, response: unknown) => void) => void
  > & { close(): void };

  raw.Ping = (request, callback) => {
    calls.push({ method: "Ping", request });
    callback(null, { ok: true });
  };
  raw.LocaleGet = (request, callback) => {
    calls.push({ method: "LocaleGet", request });
    callback(null, { found: true, content: "en-GB" });
  };
  raw.StoreGet = (request, callback) => {
    calls.push({ method: "StoreGet", request });
    callback(null, { value: "dark", found: true });
  };
  raw.StoreSet = (request, callback) => {
    calls.push({ method: "StoreSet", request });
    callback(null, { ok: true });
  };
  raw.FileRead = (request, callback) => {
    calls.push({ method: "FileRead", request });
    callback(null, { content: "file-data" });
  };
  raw.ProcessStop = (request, callback) => {
    calls.push({ method: "ProcessStop", request });
    callback(null, { ok: true });
  };
  raw.close = () => {
    closed = true;
  };

  assertEquals(
    JSON.stringify(await client.ping()),
    JSON.stringify({ ok: true }),
    "ping() should use the Ping RPC",
  );
  assertEquals(
    JSON.stringify(await client.localeGet("en-GB")),
    JSON.stringify({ found: true, content: "en-GB" }),
    "localeGet() should use the LocaleGet RPC",
  );
  assertEquals(
    JSON.stringify(await client.storeGet("corets", "theme")),
    JSON.stringify({ value: "dark", found: true }),
    "storeGet() should use the StoreGet RPC",
  );
  assertEquals(
    JSON.stringify(await client.storeSet("corets", "theme", "dark", "module-a")),
    JSON.stringify({ ok: true }),
    "storeSet() should use the StoreSet RPC",
  );
  assertEquals(
    JSON.stringify(await client.fileRead("/tmp/demo.txt", "module-a")),
    JSON.stringify({ content: "file-data" }),
    "fileRead() should use the FileRead RPC",
  );
  assertEquals(
    JSON.stringify(await client.processStop("proc-7", "module-a")),
    JSON.stringify({ ok: true }),
    "processStop() should use the ProcessStop RPC",
  );
  client.close();

  assert(closed, "close() should delegate to the raw client");
  assertEquals(
    JSON.stringify(calls.map((call) => call.method)),
    JSON.stringify([
      "Ping",
      "LocaleGet",
      "StoreGet",
      "StoreSet",
      "FileRead",
      "ProcessStop",
    ]),
    "createCoreClient() should map each helper to the expected RPC method",
  );
  assertEquals(
    JSON.stringify((calls[2]?.request as Record<string, unknown>) ?? {}),
    JSON.stringify({
      group: "corets",
      key: "theme",
      module_code: "",
    }),
    "storeGet() should default the module code when omitted",
  );
});

Deno.test("TestClient_createCoreClient_Bad", async () => {
  const client = createCoreClient("/tmp/core-deno.sock");
  const raw = client.raw as Record<
    string,
    (request: unknown, callback: (error: Error | null, response: unknown) => void) => void
  >;

  raw.Ping = (_request, callback) => {
    callback(new Error("connection refused"), undefined);
  };

  let message = "";
  try {
    await client.ping();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(
    message,
    "connection refused",
    "RPC failures should reject the helper promise",
  );
});

Deno.test("TestClient_createCoreClient_Ugly", () => {
  const client = createCoreClient("/tmp/core-deno.sock");
  client.close();
  assert(client.raw !== undefined, "createCoreClient() should always expose the raw client");
});
