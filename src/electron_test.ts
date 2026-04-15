import {
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
  const shim = buildElectronShim({
    action(channel, ...args) {
      calls.push({ channel, args });
      return { channel, args };
    },
    query(channel, ...args) {
      calls.push({ channel, args });
      return { channel, args };
    },
    on: () => () => undefined,
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

  await shim.ipcRenderer.send("app:ready", { version: "1.0" });
  await shim.shell.openExternal("https://example.com");
  await shim.notification({ title: "Alert" });
  await new shim.Notification({ title: "Alert" }).show();
  await shim.core.ipc.action("app:ready", { version: "1.0" });

  assert(calls[0].channel === "app:ready", "ipc send should use the bridge");
  assert(calls[1].channel === "gui.browser.open", "shell should map to browser open");
  assert(calls[2].channel === "gui.notification.send", "notification should use the bridge");
  assert(calls[3].channel === "gui.notification.send", "Notification class should use the bridge");
  assert(calls[4].channel === "app:ready", "core.ipc should route through the same bridge");
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
    requireShim("path/posix") === shim.path,
    "require('path/posix') should return the path proxy",
  );
  assert(
    requireShim("node:path/win32") === shim.path,
    "require('node:path/win32') should return the path proxy",
  );
  assert(
    requireShim("node:path") === shim.path,
    "require('node:path') should return the path proxy",
  );

  let message = "";
  try {
    requireShim("crypto");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(message.includes("require('crypto')"), "unsupported modules should be rejected");
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
