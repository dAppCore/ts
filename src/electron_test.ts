import {
  CoreElectronRuntime,
  buildCoreShim,
  buildElectronShim,
  buildRequireShim,
  injectElectronShim,
} from "./electron.ts";

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

Deno.test("Electron shim routes Electron APIs through the bridge", async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  let ipcHandler: ((payload: unknown[]) => void | Promise<void>) | undefined;
  const shim = buildElectronShim({
    action(channel, ...args) {
      calls.push({ channel, args });
      return { channel, args };
    },
    query(channel, ...args) {
      calls.push({ channel, args });
      return { channel, args };
    },
    on(channel, handler) {
      if (channel === "app:ready") {
        ipcHandler = handler;
      }
      return () => undefined;
    },
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  }, {
    readFile(path) {
      return path === "/var/demo.txt" ? "file-data" : null;
    },
    writeFile() {
      return undefined;
    },
    deleteFile() {
      return undefined;
    },
    readdir() {
      return ["demo.txt"];
    },
    mkdir() {
      return undefined;
    },
  });
  const seen: unknown[][] = [];
  shim.core.events.on("app:ready", (payload) => {
    seen.push(payload);
  });

  await shim.ipcRenderer.send("app:ready", { version: "1.0" });
  await shim.shell.openExternal("https://example.com");
  await shim.notification({ title: "Alert" });
  await new shim.Notification({ title: "Alert" }).show();
  await shim.core.ipc.action("app:ready", { version: "1.0" });
  await ipcHandler?.([{ version: "1.0" }]);

  assert(calls[0].channel === "app:ready", "ipc send should use the bridge");
  assert(calls[1].channel === "gui.browser.open", "shell should map to browser open");
  assert(calls[2].channel === "gui.notification.send", "notification should use the bridge");
  assert(calls[3].channel === "gui.notification.send", "Notification class should use the bridge");
  assert(calls[4].channel === "app:ready", "core.ipc should route through the same bridge");
  assertEquals(seen.length, 1, "core.events should receive mirrored IPC events");
  assert(shim.fs.promises.readFile !== undefined, "fs.promises should be exposed");
  const expectedPath = Deno.build.os === "windows" ? "\\var" : "/var";
  assert(
    shim.path.resolve("/tmp", "..", "var") === expectedPath,
    "path.resolve should follow the host platform",
  );
  assertEquals(
    shim.fs.readFileSync("/var/demo.txt"),
    "file-data",
    "fs.readFileSync should use the synchronous bridge surface when available",
  );
  assertEquals(
    shim.fs.readdirSync("/var"),
    ["demo.txt"],
    "fs.readdirSync should use the synchronous bridge surface when available",
  );
});

Deno.test("CoreElectronRuntime mirrors bridge events into the browser event bus", async () => {
  let onHandler: ((payload: unknown[]) => void | Promise<void>) | undefined;
  const runtime = new CoreElectronRuntime({
    action: () => undefined,
    query: () => undefined,
    on(channel, handler) {
      if (channel === "app:ready") {
        onHandler = handler;
      }
      return () => undefined;
    },
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  });

  const seen: unknown[][] = [];
  runtime.events().on("app:ready", (payload) => {
    seen.push(payload);
  });

  await runtime.shimObject().ipcRenderer.on("app:ready", () => undefined);
  await onHandler?.([{ version: "1.0" }]);

  assertEquals(seen.length, 1, "bridge events should reach the event bus");
  assertEquals(
    seen[0],
    [{ version: "1.0" }],
    "event bus should receive the same payload as the bridge handler",
  );
});

Deno.test("Electron require shim only exposes supported modules", () => {
  const shim = buildElectronShim({
    action: () => undefined,
    query: () => undefined,
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  });
  const requireShim = buildRequireShim(shim);

  assert(requireShim("electron") === shim, "require('electron') should return the shim");
  assert(requireShim("fs") === shim.fs, "require('fs') should return the filesystem proxy");
  assert(
    requireShim("node:fs") === shim.fs,
    "require('node:fs') should return the filesystem proxy",
  );
  assert(
    requireShim("fs/promises") === shim.fs.promises,
    "require('fs/promises') should return the promise API",
  );
  assert(requireShim("path") === shim.path, "require('path') should return the path proxy");
  assert(
    requireShim("path/posix") === shim.path.posix,
    "require('path/posix') should return the POSIX path proxy",
  );
  assert(
    requireShim("node:path/win32") === shim.path.win32,
    "require('node:path/win32') should return the Windows path proxy",
  );
  assert(
    requireShim("node:path") === shim.path,
    "require('node:path') should return the host path proxy",
  );
  assertEquals(
    shim.path.posix.sep,
    "/",
    "path.posix should always use the POSIX separator",
  );
  assertEquals(
    shim.path.win32.sep,
    "\\",
    "path.win32 should always use the Windows separator",
  );

  let message = "";
  try {
    requireShim("crypto");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(message.includes("require('crypto')"), "crypto should have a targeted rejection");
  assert(message.includes("CoreCrypto"), "crypto rejection should point callers to CoreCrypto");

  message = "";
  try {
    requireShim("net");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(message.includes("require('net')"), "net should have a targeted rejection");
  assert(message.includes("CoreNet"), "net rejection should point callers to CoreNet");
});

Deno.test("Electron injector defines globals", () => {
  const globalTarget: Record<string, unknown> = {};
  injectElectronShim({
    action: () => undefined,
    query: () => undefined,
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  }, {
    target: globalTarget,
  });

  const electronDescriptor = Object.getOwnPropertyDescriptor(globalTarget, "electron");
  const coreDescriptor = Object.getOwnPropertyDescriptor(globalTarget, "core");
  const requireDescriptor = Object.getOwnPropertyDescriptor(globalTarget, "require");

  assert(electronDescriptor?.get !== undefined, "electron global should be injected via a getter");
  assert(coreDescriptor?.get !== undefined, "core global should be injected via a getter");
  assert(requireDescriptor?.get !== undefined, "require global should be injected via a getter");
  assert(electronDescriptor?.configurable === false, "electron global should be immutable");
  assert(coreDescriptor?.configurable === false, "core global should be immutable");
  assert(requireDescriptor?.configurable === false, "require global should be immutable");
});

Deno.test("Core bridge exposes the RFC core.ipc surface", () => {
  const core = buildCoreShim({
    action: () => "action",
    query: () => "query",
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    offAll: () => undefined,
  });

  assert(core.ipc.action("gui.ping") === "action", "core.ipc.action should proxy actions");
  assert(core.ipc.query("gui.ping") === "query", "core.ipc.query should proxy queries");
});
