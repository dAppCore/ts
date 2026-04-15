import {
  RuntimeHostBridge,
  RuntimeRPCClient,
  type RuntimeIPCChannel,
  type RuntimeIPCMessage,
} from "./ipc.ts";

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

Deno.test("TestIpc_RuntimeRPCClient_Good", async () => {
  const messages: RuntimeIPCMessage[] = [];
  const channel: RuntimeIPCChannel = {
    post(message) {
      messages.push(message);
    },
  };
  const client = new RuntimeRPCClient(channel);

  const pending = client.request("StoreSet", {
    group: "demo",
    key: "theme",
    value: "dark",
  });

  assertEquals(messages.length, 1, "request() should post a single RPC message");
  assertEquals(
    JSON.stringify(messages[0]),
    JSON.stringify({
      type: "rpc",
      id: 1,
      method: "StoreSet",
      params: {
        group: "demo",
        key: "theme",
        value: "dark",
      },
    }),
    "request() should serialise the RPC payload",
  );

  assert(
    client.handle({
      type: "rpc_response",
      id: 1,
      result: { ok: true },
    }),
    "handle() should accept matching responses",
  );
  assertEquals(
    JSON.stringify(await pending),
    JSON.stringify({ ok: true }),
    "request() should resolve with the matching response result",
  );
});

Deno.test("TestIpc_RuntimeRPCClient_Bad", () => {
  const client = new RuntimeRPCClient({
    post() {
      return undefined;
    },
  });

  assert(
    !client.handle({ type: "ready" }),
    "handle() should ignore non-RPC responses",
  );
  assert(
    client.handle({
      type: "rpc_response",
      id: 99,
      result: { ignored: true },
    }),
    "handle() should treat unknown RPC responses as handled",
  );
});

Deno.test("TestIpc_RuntimeHostBridge_Ugly", async () => {
  const posts: RuntimeIPCMessage[] = [];
  const bridge = new RuntimeHostBridge(
    {
      post(message) {
        posts.push(message);
      },
    },
    {
      onReady() {
        return undefined;
      },
      onLoaded() {
        return undefined;
      },
      dispatch() {
        throw "boom";
      },
    },
  );

  assert(
    await bridge.handle({
      type: "rpc",
      id: 7,
      method: "FileRead",
      params: { path: "/tmp/demo.txt" },
    }),
    "handle() should process RPC requests even when dispatch throws",
  );

  assertEquals(
    JSON.stringify(posts[0]),
    JSON.stringify({
      type: "rpc_response",
      id: 7,
      error: "boom",
    }),
    "handle() should serialise thrown values into the RPC error response",
  );
});

// Missing seam: RuntimeHostBridge.onReady/onLoaded are exercised indirectly via
// runtime/modules.ts, but there is no pure unit path that injects both callbacks
// without the worker registry. Add a dedicated seam if direct coverage is needed.

