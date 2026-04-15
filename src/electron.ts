import path from "node:path";

import { CoreEventBus, type CoreEventHandler } from "./events.ts";

export interface ElectronBridge {
  action(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
  query(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
  on(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
  once(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
  off(channel: string, handler: CoreEventHandler<unknown[]>): void;
  offAll(channel?: string): void;
}

export interface WailsBridge {
  action(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
  query(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
  on(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
  once(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
  off(channel: string, handler: CoreEventHandler<unknown[]>): void;
  offAll(channel?: string): void;
}

export interface ElectronFileBridge {
  readFile(path: string): Promise<string | null> | string | null;
  writeFile(path: string, content: string): Promise<void> | void;
  deleteFile(path: string): Promise<void> | void;
  readdir(path: string): Promise<string[]> | string[];
  mkdir(path: string): Promise<void> | void;
}

export interface ElectronShimOptions {
  origin?: string;
  fs?: ElectronFileBridge;
  target?: Record<string, unknown>;
}

export interface ElectronShim {
  core: CoreShim;
  ipcRenderer: {
    send(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
    invoke(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
    on(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
    once(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
    removeListener(channel: string, handler: CoreEventHandler<unknown[]>): void;
    removeAllListeners(channel?: string): void;
  };
  shell: {
    openExternal(url: string): Promise<unknown> | unknown;
    openPath(path: string): Promise<unknown> | unknown;
  };
  clipboard: {
    readText(): Promise<unknown> | unknown;
    writeText(text: string): Promise<unknown> | unknown;
  };
  dialog: {
    showOpenDialog(options: unknown): Promise<unknown> | unknown;
    showSaveDialog(options: unknown): Promise<unknown> | unknown;
    showMessageBox(options: unknown): Promise<unknown> | unknown;
  };
  notification(options: unknown): Promise<unknown> | unknown;
  Notification: new (options: unknown) => { show(): Promise<unknown> | unknown };
  fs: ElectronFileProxy;
  path: ElectronPathProxy;
}

export interface CoreShim {
  ipc: {
    action(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
    query(channel: string, ...args: unknown[]): Promise<unknown> | unknown;
    on(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
    once(channel: string, handler: CoreEventHandler<unknown[]>): () => void;
    off(channel: string, handler: CoreEventHandler<unknown[]>): void;
    offAll(channel?: string): void;
  };
  browser: {
    open(url: string): Promise<unknown> | unknown;
    openFile(path: string): Promise<unknown> | unknown;
  };
  clipboard: {
    read(): Promise<unknown> | unknown;
    write(text: string): Promise<unknown> | unknown;
  };
  dialog: {
    open(options: unknown): Promise<unknown> | unknown;
    save(options: unknown): Promise<unknown> | unknown;
    message(options: unknown): Promise<unknown> | unknown;
  };
  notification: {
    send(options: unknown): Promise<unknown> | unknown;
  };
  fs: ElectronFileProxy;
  path: ElectronPathProxy;
  events: CoreEventBus<Record<string, unknown[]>>;
}

export interface ElectronFileProxy {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  readFileSync(path: string): string | null;
  writeFileSync(path: string, content: string): void;
  unlinkSync(path: string): void;
  readdirSync(path: string): string[];
  mkdirSync(path: string): void;
  promises: {
    readFile(path: string): Promise<string | null>;
    writeFile(path: string, content: string): Promise<void>;
    unlink(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string): Promise<void>;
  };
}

export interface ElectronPathProxy {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  normalize(path: string): string;
  sep: string;
  delimiter: string;
  posix: ElectronPathProxy;
  win32: ElectronPathProxy;
}

export class CoreElectronRuntime {
  private readonly bus = new CoreEventBus<Record<string, unknown[]>>();
  private readonly shim: ElectronShim;

  constructor(
    private readonly bridge: ElectronBridge,
    private readonly options: ElectronShimOptions = {},
  ) {
    this.shim = buildElectronShim(
      bridge,
      options.fs,
      options.origin,
      this.bus,
    );
  }

  inject(
    target: Record<string, unknown> = this.options.target ?? (globalThis as Record<string, unknown>),
  ): ElectronShim {
    const requireShim = buildRequireShim(this.shim);
    defineGetter(target, "core", () => this.shim.core);
    defineGetter(target, "electron", () => this.shim);
    defineGetter(target, "require", () => requireShim);
    return this.shim;
  }

  events(): CoreEventBus<Record<string, unknown[]>> {
    return this.bus;
  }

  shimObject(): ElectronShim {
    return this.shim;
  }
}

export function buildElectronShim(
  bridge: ElectronBridge,
  fsBridge?: ElectronFileBridge,
  origin = "file://",
  events = new CoreEventBus<Record<string, unknown[]>>(),
): ElectronShim {
  const mirroredBridge = createMirroredElectronBridge(bridge, events);
  const core = buildCoreShim(mirroredBridge, fsBridge, origin, events);
  return {
    core,
    ipcRenderer: {
      send: (channel: string, ...args: unknown[]) => core.ipc.action(channel, ...args),
      invoke: (channel: string, ...args: unknown[]) => core.ipc.query(channel, ...args),
      on: (channel: string, handler: CoreEventHandler<unknown[]>) => core.ipc.on(channel, handler),
      once: (channel: string, handler: CoreEventHandler<unknown[]>) => core.ipc.once(channel, handler),
      removeListener: (channel: string, handler: CoreEventHandler<unknown[]>) => core.ipc.off(channel, handler),
      removeAllListeners: (channel?: string) => core.ipc.offAll(channel),
    },
    shell: {
      openExternal: (url: string) => core.browser.open(url),
      openPath: (path: string) => core.browser.openFile(path),
    },
    clipboard: {
      readText: () => core.clipboard.read(),
      writeText: (text: string) => core.clipboard.write(text),
    },
    dialog: {
      showOpenDialog: (options: unknown) => core.dialog.open(options),
      showSaveDialog: (options: unknown) => core.dialog.save(options),
      showMessageBox: (options: unknown) => core.dialog.message(options),
    },
    notification: (options: unknown) => core.notification.send(options),
    Notification: class CoreNotification {
      constructor(private readonly options: unknown) {}

      show(): Promise<unknown> | unknown {
        return core.notification.send(this.options);
      }
    },
    fs: core.fs,
    path: core.path,
  };
}

export function buildCoreShim(
  bridge: ElectronBridge,
  fsBridge?: ElectronFileBridge,
  origin = "file://",
  events = new CoreEventBus<Record<string, unknown[]>>(),
): CoreShim {
  const fs = buildFileProxy(fsBridge, origin);
  const path = buildPathProxy();
  return {
    ipc: {
      action: (channel: string, ...args: unknown[]) => bridge.action(channel, ...args),
      query: (channel: string, ...args: unknown[]) => bridge.query(channel, ...args),
      on: (channel: string, handler: CoreEventHandler<unknown[]>) => bridge.on(channel, handler),
      once: (channel: string, handler: CoreEventHandler<unknown[]>) => bridge.once(channel, handler),
      off: (channel: string, handler: CoreEventHandler<unknown[]>) => bridge.off(channel, handler),
      offAll: (channel?: string) => bridge.offAll(channel),
    },
    browser: {
      open: (url: string) => bridge.action("gui.browser.open", { url }),
      openFile: (filePath: string) => bridge.action("gui.browser.openFile", { path: filePath }),
    },
    clipboard: {
      read: () => bridge.query("gui.clipboard.read"),
      write: (text: string) => bridge.action("gui.clipboard.write", { text }),
    },
    dialog: {
      open: (options: unknown) => bridge.query("gui.dialog.open", options),
      save: (options: unknown) => bridge.query("gui.dialog.save", options),
      message: (options: unknown) => bridge.query("gui.dialog.message", options),
    },
    notification: {
      send: (options: unknown) => bridge.action("gui.notification.send", options),
    },
    fs,
    path,
    events,
  };
}

export function buildRequireShim(shim: ElectronShim): (module: string) => unknown {
  return (module: string) => {
    switch (normaliseModuleName(module)) {
      case "electron":
        return shim;
      case "fs":
        return shim.fs;
      case "fs/promises":
        return shim.fs.promises;
      case "path":
        return shim.path;
      case "path/posix":
        return shim.path.posix;
      case "path/win32":
        return shim.path.win32;
      case "crypto":
        throw new Error(
          "require('crypto') is not available in CoreTS. Use CoreCrypto instead.",
        );
      case "net":
        throw new Error(
          "require('net') is not available in CoreTS. Use CoreNet instead.",
        );
      default:
        throw new Error(
          `require('${module}') is not available. Use Core imports instead.`,
        );
    }
  };
}

export function injectElectronShim(
  bridge: ElectronBridge,
  options: ElectronShimOptions = {},
): ElectronShim {
  const target = options.target ?? (globalThis as Record<string, unknown>);
  const shim = buildElectronShim(bridge, options.fs, options.origin);
  defineGetter(target, "core", () => shim.core);
  const requireShim = buildRequireShim(shim);
  defineGetter(target, "electron", () => shim);
  defineGetter(target, "require", () => requireShim);
  return shim;
}

function buildFileProxy(fsBridge: ElectronFileBridge | undefined, origin: string): ElectronFileProxy {
  const unsupported = async (_path: string): Promise<never> => {
    throw new Error(`fs bridge is not configured for ${origin}`);
  };
  const unsupportedSync = (): never => {
    throw new Error(`fs bridge is not configured for ${origin}`);
  };

  const syncOrThrow = <T>(value: T | Promise<T>): T => {
    if (isPromiseLike(value)) {
      throw new Error(
        `fs bridge is asynchronous for ${origin}; use fs.promises instead`,
      );
    }
    return value;
  };

  if (!fsBridge) {
    return {
      readFile: unsupported,
      writeFile: async (_path: string, _content: string): Promise<void> => {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
      unlink: unsupported,
      readdir: async (_path: string): Promise<string[]> => {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
      mkdir: async (_path: string): Promise<void> => {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
      readFileSync: unsupportedSync,
      writeFileSync: unsupportedSync,
      unlinkSync: unsupportedSync,
      readdirSync: unsupportedSync,
      mkdirSync: unsupportedSync,
      promises: {
        readFile: unsupported,
        writeFile: async (_path: string, _content: string): Promise<void> => {
          throw new Error(`fs bridge is not configured for ${origin}`);
        },
        unlink: unsupported,
        readdir: async (_path: string): Promise<string[]> => {
          throw new Error(`fs bridge is not configured for ${origin}`);
        },
        mkdir: async (_path: string): Promise<void> => {
          throw new Error(`fs bridge is not configured for ${origin}`);
        },
      },
    };
  }

  const readFile = (filePath: string) => Promise.resolve(fsBridge.readFile(filePath));
  const writeFile = (filePath: string, content: string) => Promise.resolve(fsBridge.writeFile(filePath, content));
  const unlink = (filePath: string) => Promise.resolve(fsBridge.deleteFile(filePath));
  const readdir = (dirPath: string) => Promise.resolve(fsBridge.readdir(dirPath));
  const mkdir = (dirPath: string) => Promise.resolve(fsBridge.mkdir(dirPath));

  return {
    readFile,
    writeFile,
    unlink,
    readdir,
    mkdir,
    readFileSync: (filePath: string) => syncOrThrow(fsBridge.readFile(filePath)),
    writeFileSync: (filePath: string, content: string) => {
      syncOrThrow(fsBridge.writeFile(filePath, content));
    },
    unlinkSync: (filePath: string) => {
      syncOrThrow(fsBridge.deleteFile(filePath));
    },
    readdirSync: (dirPath: string) => syncOrThrow(fsBridge.readdir(dirPath)),
    mkdirSync: (dirPath: string) => {
      syncOrThrow(fsBridge.mkdir(dirPath));
    },
    promises: {
      readFile,
      writeFile,
      unlink,
      readdir,
      mkdir,
    },
  };
}

function buildPathProxy(platform: "host" | "posix" | "win32" = "host"): ElectronPathProxy {
  const resolvedPlatform = platform === "host"
    ? (isWindowsPlatform() ? "win32" : "posix")
    : platform;
  const proxy = createBasePathProxy(resolvedPlatform);
  const posixProxy = createBasePathProxy("posix");
  const win32Proxy = createBasePathProxy("win32");

  proxy.posix = posixProxy as ElectronPathProxy;
  proxy.win32 = win32Proxy as ElectronPathProxy;
  posixProxy.posix = posixProxy as ElectronPathProxy;
  posixProxy.win32 = win32Proxy as ElectronPathProxy;
  win32Proxy.posix = posixProxy as ElectronPathProxy;
  win32Proxy.win32 = win32Proxy as ElectronPathProxy;

  return proxy as ElectronPathProxy;
}

function createBasePathProxy(platform: "posix" | "win32"): Omit<
  ElectronPathProxy,
  "posix" | "win32"
> & { posix?: ElectronPathProxy; win32?: ElectronPathProxy } {
  const platformPath = platform === "win32" ? path.win32 : path.posix;

  return {
    join: (...parts: string[]) => platformPath.join(...parts),
    resolve: (...parts: string[]) => platformPath.resolve(...parts),
    relative: (from: string, to: string) => platformPath.relative(from, to),
    dirname: (filePath: string) => platformPath.dirname(filePath),
    basename: (filePath: string, ext = "") => platformPath.basename(filePath, ext),
    extname: (filePath: string) => platformPath.extname(filePath),
    normalize: (filePath: string) => platformPath.normalize(filePath),
    sep: platformPath.sep,
    delimiter: platformPath.delimiter,
    posix: undefined,
    win32: undefined,
  };
}

function defineGetter(
  target: Record<string, unknown>,
  key: string,
  get: () => unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    get,
  });
}

function createMirroredElectronBridge(
  bridge: ElectronBridge,
  events: CoreEventBus<Record<string, unknown[]>>,
): ElectronBridge {
  return {
    action: (channel: string, ...args: unknown[]) => bridge.action(channel, ...args),
    query: (channel: string, ...args: unknown[]) => bridge.query(channel, ...args),
    on: (channel: string, handler: CoreEventHandler<unknown[]>) =>
      bridge.on(channel, async (payload) => {
        await events.emit(channel, payload);
        await handler(payload);
      }),
    once: (channel: string, handler: CoreEventHandler<unknown[]>) =>
      bridge.once(channel, async (payload) => {
        await events.emit(channel, payload);
        await handler(payload);
      }),
    off: (channel: string, handler: CoreEventHandler<unknown[]>) => bridge.off(channel, handler),
    offAll: (channel?: string) => bridge.offAll(channel),
  };
}

function isWindowsPlatform(): boolean {
  if (typeof process !== "undefined" && typeof process.platform === "string") {
    return process.platform === "win32";
  }
  if (typeof Deno !== "undefined" && typeof Deno.build?.os === "string") {
    return Deno.build.os === "windows";
  }
  return path.sep === "\\";
}

function normaliseModuleName(module: string): string {
  return module.startsWith("node:") ? module.slice(5) : module;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return !!value && typeof value === "object" && typeof (value as PromiseLike<T>).then === "function";
}
