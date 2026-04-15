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

export interface ElectronFileProxy {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
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
}

export class CoreElectronRuntime {
  private readonly bus = new CoreEventBus<Record<string, unknown[]>>();
  private readonly shim: ElectronShim;

  constructor(
    private readonly bridge: ElectronBridge,
    private readonly options: ElectronShimOptions = {},
  ) {
    this.shim = buildElectronShim(bridge, options.fs, options.origin);
  }

  inject(
    target: Record<string, unknown> = this.options.target ?? (globalThis as Record<string, unknown>),
  ): ElectronShim {
    define(target, "electron", this.shim);
    define(target, "require", buildRequireShim(this.shim));
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
): ElectronShim {
  return {
    ipcRenderer: {
      send: (channel: string, ...args: unknown[]) => bridge.action(channel, ...args),
      invoke: (channel: string, ...args: unknown[]) => bridge.query(channel, ...args),
      on: (channel: string, handler: CoreEventHandler<unknown[]>) => bridge.on(channel, handler),
      once: (channel: string, handler: CoreEventHandler<unknown[]>) => bridge.once(channel, handler),
      removeListener: (channel: string, handler: CoreEventHandler<unknown[]>) => bridge.off(channel, handler),
      removeAllListeners: (channel?: string) => bridge.offAll(channel),
    },
    shell: {
      openExternal: (url: string) => bridge.action("gui.browser.open", { url }),
      openPath: (path: string) => bridge.action("gui.browser.openFile", { path }),
    },
    clipboard: {
      readText: () => bridge.query("gui.clipboard.read"),
      writeText: (text: string) => bridge.action("gui.clipboard.write", { text }),
    },
    dialog: {
      showOpenDialog: (options: unknown) => bridge.query("gui.dialog.open", options),
      showSaveDialog: (options: unknown) => bridge.query("gui.dialog.save", options),
      showMessageBox: (options: unknown) => bridge.query("gui.dialog.message", options),
    },
    notification: (options: unknown) => bridge.action("gui.notification.send", options),
    Notification: class CoreNotification {
      constructor(private readonly options: unknown) {}

      show(): Promise<unknown> | unknown {
        return bridge.action("gui.notification.send", this.options);
      }
    },
    fs: buildFileProxy(fsBridge, origin),
    path: buildPathProxy(),
  };
}

export function buildRequireShim(shim: ElectronShim): (module: string) => unknown {
  return (module: string) => {
    switch (module) {
      case "electron":
        return shim;
      case "fs":
        return shim.fs;
      case "path":
        return shim.path;
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
  define(target, "electron", shim);
  define(target, "require", buildRequireShim(shim));
  return shim;
}

function buildFileProxy(fsBridge: ElectronFileBridge | undefined, origin: string): ElectronFileProxy {
  const unsupported = async (_path: string): Promise<never> => {
    throw new Error(`fs bridge is not configured for ${origin}`);
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
    promises: {
      readFile,
      writeFile,
      unlink,
      readdir,
      mkdir,
    },
  };
}

function buildPathProxy(): ElectronPathProxy {
  return {
    join: (...parts: string[]) => path.posix.join(...parts),
    resolve: (...parts: string[]) => path.posix.resolve(...parts),
    relative: (from: string, to: string) => path.posix.relative(from, to),
    dirname: (filePath: string) => path.posix.dirname(filePath),
    basename: (filePath: string, ext = "") => path.posix.basename(filePath, ext),
    extname: (filePath: string) => path.posix.extname(filePath),
    normalize: (filePath: string) => path.posix.normalize(filePath),
    sep: path.posix.sep,
    delimiter: path.posix.delimiter,
  };
}

function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
