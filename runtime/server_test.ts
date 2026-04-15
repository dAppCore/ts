import { startDenoServer } from "./server.ts";

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

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (!buffer.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
  }

  const line = buffer.split("\n")[0] ?? "";
  return line.trim();
}

Deno.test("TestServer_startDenoServer_Good", async () => {
  const tempDir = await Deno.makeTempDir();
  const socketPath = `${tempDir}/core.sock`;
  await Deno.writeTextFile(socketPath, "stale socket");

  const calls: Array<{ method: string; code?: string }> = [];
  const registry = {
    load: async (code: string, entryPoint: string) => {
      calls.push({ method: "LoadModule", code });
      return { ok: true, code, entryPoint };
    },
    unload: (code: string) => {
      calls.push({ method: "UnloadModule", code });
      return true;
    },
    status: (code: string) => {
      calls.push({ method: "ModuleStatus", code });
      return "RUNNING";
    },
    reloadAll: async () => {
      calls.push({ method: "ReloadModules" });
      return [{ ok: true }];
    },
  } as const;

  const server = await startDenoServer(socketPath, registry as never);

  try {
    const socketInfo = await Deno.stat(socketPath);
    assert(
      socketInfo.isSocket === true,
      "startDenoServer() should replace stale files with a Unix socket",
    );

    const conn = await Deno.connect({ transport: "unix", path: socketPath });
    const writer = conn.writable.getWriter();
    const reader = conn.readable.getReader();

    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "Ping" }) + "\n",
      ),
    );

    const pingResponse = JSON.parse(await readLine(reader)) as {
      jsonrpc: string;
      id: number;
      result: { ok: boolean };
    };
    assertEquals(pingResponse.result.ok, true, "Ping should succeed");

    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "LoadModule",
          params: {
            code: "demo",
            entry_point: "/workspace/demo.ts",
            permissions: { read: ["./demo"] },
          },
        }) + "\n",
      ),
    );

    const loadResponse = JSON.parse(await readLine(reader)) as {
      jsonrpc: string;
      id: number;
      result: { ok: boolean; code: string; entryPoint: string };
    };
    assertEquals(loadResponse.result.ok, true, "LoadModule should succeed");
    assertEquals(
      JSON.stringify(calls),
      JSON.stringify([
        { method: "LoadModule", code: "demo" },
      ]),
      "LoadModule should dispatch through the registry",
    );

    await writer.close();
  } finally {
    server.close();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("TestServer_startDenoServer_Bad", async () => {
  const tempDir = await Deno.makeTempDir();
  const socketPath = `${tempDir}/core.sock`;
  const registry = {
    load: async () => ({ ok: true }),
    unload: () => true,
    status: () => "RUNNING",
    reloadAll: async () => [{ ok: true }],
  } as const;

  const server = await startDenoServer(socketPath, registry as never);

  try {
    const conn = await Deno.connect({ transport: "unix", path: socketPath });
    const writer = conn.writable.getWriter();
    const reader = conn.readable.getReader();

    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "LoadModule",
          params: { entry_point: "/workspace/demo.ts" },
        }) + "\n",
      ),
    );

    const response = JSON.parse(await readLine(reader)) as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    assertEquals(response.error.code, -32602, "missing module code should be rejected");
    assertEquals(
      response.error.message,
      "module code required",
      "LoadModule should validate the module code",
    );

    await writer.close();
  } finally {
    server.close();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("TestServer_startDenoServer_Ugly", async () => {
  const tempDir = await Deno.makeTempDir();
  const socketPath = `${tempDir}/core.sock`;
  const registry = {
    load: async () => ({ ok: true }),
    unload: () => true,
    status: () => "RUNNING",
    reloadAll: async () => [{ ok: true }],
  } as const;

  const server = await startDenoServer(socketPath, registry as never);

  try {
    const conn = await Deno.connect({ transport: "unix", path: socketPath });
    const writer = conn.writable.getWriter();
    const reader = conn.readable.getReader();

    await writer.write(new TextEncoder().encode(`${"a".repeat((1 << 20) + 1)}\n`));
    const response = JSON.parse(await readLine(reader)) as {
      error: string;
    };

    assertEquals(
      response.error,
      "request too large",
      "oversized requests should be rejected before parsing",
    );

    await writer.close();
  } finally {
    server.close();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("TestServer_startDenoServer_Bad_SocketDirSymlink", async () => {
  const tempDir = await Deno.makeTempDir();
  const targetDir = `${tempDir}/target`;
  const linkDir = `${tempDir}/link`;
  await Deno.mkdir(targetDir, { recursive: true });
  try {
    await Deno.symlink(targetDir, linkDir);
  } catch (error) {
    console.warn(`symlinks are not available: ${error}`);
    await Deno.remove(tempDir, { recursive: true });
    return;
  }

  const registry = {
    load: async () => ({ ok: true }),
    unload: () => true,
    status: () => "RUNNING",
    reloadAll: async () => [{ ok: true }],
  } as const;

  await startDenoServer(`${linkDir}/core.sock`, registry as never).then(
    () => {
      throw new Error("startDenoServer should reject symlinked socket parents");
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert(
        message.includes("symlink"),
        "startDenoServer should reject socket directories that are symlinks",
      );
    },
  );

  await Deno.remove(tempDir, { recursive: true });
});
