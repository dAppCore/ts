import {
  injectElectronShim,
  type ElectronFileBridge,
  type ElectronBridge,
  type ElectronShim,
  type ElectronShimOptions,
  type WailsBridge,
} from "./electron.ts";
import {
  injectStoragePolyfills,
  type CoreFileBridge,
  type CoreStorageBridge,
  type CoreStoragePolyfills,
  type InjectStoragePolyfillsOptions,
} from "./storage.ts";

export interface CoreRuntimeInjectionOptions {
  origin: string;
  storage?: CoreStorageBridge;
  electron?: ElectronBridge;
  wails?: WailsBridge;
  fs?: ElectronFileBridge;
  sessionId?: string;
  target?: Record<string, unknown>;
}

export interface CoreRuntimeInjection {
  storage?: CoreStoragePolyfills;
  electron?: ElectronShim;
  wails?: WailsBridge;
  ready: Promise<void>;
}

/**
 * Example:
 *   injectCoreRuntime({
 *     origin: "app://demo",
 *     storage: bridge,
 *     wails: bridge,
 *     sessionId: "session-1",
 *   });
 *
 * Injects the browser preload surface in one call.
 *
 * This is the composite helper used by display-layer preload hooks when they need
 * both storage polyfills and the Electron compatibility shim before page scripts run.
 */
export function injectCoreRuntime(
  options: CoreRuntimeInjectionOptions,
): CoreRuntimeInjection {
  const target = options.target ?? (globalThis as Record<string, unknown>);
  const readyTasks: Promise<void>[] = [];
  const result: CoreRuntimeInjection = {
    ready: Promise.resolve(),
  };

  if (options.storage) {
    const storageOptions: InjectStoragePolyfillsOptions = {
      sessionId: options.sessionId,
      target,
    };
    result.storage = injectStoragePolyfills(
      options.origin,
      options.storage,
      storageOptions,
    );
    readyTasks.push(result.storage.ready);
  }

  if (options.electron || options.wails) {
    const electronOptions: ElectronShimOptions = {
      target,
      fs: options.fs ?? adaptStorageFileBridge(options.origin, options.storage?.fs),
      origin: options.origin,
      wails: options.wails,
    };
    const bridge = options.electron ?? options.wails;
    if (bridge) {
      result.electron = injectElectronShim(bridge, electronOptions);
    }
  }
  if (options.wails) {
    result.wails = options.wails;
  }

  result.ready = readyTasks.length === 0
    ? Promise.resolve()
    : Promise.all(readyTasks).then(() => undefined);
  void result.ready.catch(() => undefined);

  return result;
}

export function adaptStorageFileBridge(
  origin: string,
  bridge?: CoreFileBridge,
): ElectronFileBridge | undefined {
  if (!bridge) {
    return undefined;
  }

  return {
    readFile(path: string) {
      return bridge.read(origin, path);
    },
    writeFile(path: string, content: string) {
      return bridge.write(origin, path, content);
    },
    deleteFile(path: string) {
      return bridge.delete(origin, path);
    },
    readdir(path: string) {
      return bridge.list(origin, path);
    },
    mkdir(path: string) {
      return bridge.mkdir(origin, path);
    },
  };
}
