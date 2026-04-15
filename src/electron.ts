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
}

export interface ElectronPathProxy {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  normalize(path: string): string;
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
  if (!fsBridge) {
    return {
      async readFile(_path: string): Promise<string | null> {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
      async writeFile(_path: string, _content: string): Promise<void> {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
      async unlink(_path: string): Promise<void> {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
      async readdir(_path: string): Promise<string[]> {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
      async mkdir(_path: string): Promise<void> {
        throw new Error(`fs bridge is not configured for ${origin}`);
      },
    };
  }

  return {
    readFile: (path: string) => Promise.resolve(fsBridge.readFile(path)),
    writeFile: (path: string, content: string) => Promise.resolve(fsBridge.writeFile(path, content)),
    unlink: (path: string) => Promise.resolve(fsBridge.deleteFile(path)),
    readdir: (path: string) => Promise.resolve(fsBridge.readdir(path)),
    mkdir: (path: string) => Promise.resolve(fsBridge.mkdir(path)),
  };
}

function buildPathProxy(): ElectronPathProxy {
  const separator = "/";
  return {
    join: (...parts: string[]) => parts.filter(Boolean).join(separator).replace(/\/+/g, "/"),
    dirname: (path: string) => {
      const normalised = path.replace(/\/+$/, "");
      const index = normalised.lastIndexOf(separator);
      if (index <= 0) {
        return ".";
      }
      return normalised.slice(0, index);
    },
    basename: (path: string, ext = "") => {
      const normalised = path.replace(/\/+$/, "");
      const index = normalised.lastIndexOf(separator);
      const base = index >= 0 ? normalised.slice(index + 1) : normalised;
      if (ext && base.endsWith(ext)) {
        return base.slice(0, -ext.length);
      }
      return base;
    },
    extname: (path: string) => {
      const base = path.split(separator).pop() ?? "";
      const dot = base.lastIndexOf(".");
      return dot > 0 ? base.slice(dot) : "";
    },
    normalize: (path: string) => path.replace(/\/+/g, "/"),
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
