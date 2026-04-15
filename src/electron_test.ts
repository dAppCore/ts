import { buildElectronShim, buildRequireShim, injectElectronShim } from "./electron.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
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
  });

  await shim.ipcRenderer.send("app:ready", { version: "1.0" });
  await shim.shell.openExternal("https://example.com");
  await shim.notification({ title: "Alert" });
  await new shim.Notification({ title: "Alert" }).show();

  assert(calls[0].channel === "app:ready", "ipc send should use the bridge");
  assert(calls[1].channel === "gui.browser.open", "shell should map to browser open");
  assert(calls[2].channel === "gui.notification.send", "notification should use the bridge");
  assert(calls[3].channel === "gui.notification.send", "Notification class should use the bridge");
  assert(shim.fs.promises.readFile !== undefined, "fs.promises should be exposed");
  assert(
    shim.path.resolve("/tmp", "..", "var") === "/var",
    "path.resolve should behave like posix path resolution",
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
  assert(requireShim("path") === shim.path, "require('path') should return the path proxy");

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

  assert("electron" in globalTarget, "electron global should be injected");
  assert("require" in globalTarget, "require global should be injected");
});
