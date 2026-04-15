import {
  injectElectronShim,
  type ElectronBridge,
  type ElectronShim,
  type ElectronShimOptions,
  type WailsBridge,
} from "./electron.ts";
import {
  injectStoragePolyfills,
  type CoreStorageBridge,
  type CoreStoragePolyfills,
  type InjectStoragePolyfillsOptions,
} from "./storage.ts";

export interface CoreRuntimeInjectionOptions {
  origin: string;
  storage?: CoreStorageBridge;
  electron?: ElectronBridge;
  wails?: WailsBridge;
  sessionId?: string;
  target?: Record<string, unknown>;
}

export interface CoreRuntimeInjection {
  storage?: CoreStoragePolyfills;
  electron?: ElectronShim;
  wails?: WailsBridge;
}

/**
 * Injects the browser preload surface in one call.
 *
 * This is the composite helper used by display-layer preload hooks when they need
 * both storage polyfills and the Electron compatibility shim before page scripts run.
 */
export function injectCoreRuntime(
  options: CoreRuntimeInjectionOptions,
): CoreRuntimeInjection {
  const target = options.target ?? (globalThis as Record<string, unknown>);
  const result: CoreRuntimeInjection = {};

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
  }

  if (options.electron || options.wails) {
    const electronOptions: ElectronShimOptions = { target };
    const bridge = options.electron ?? options.wails;
    if (bridge) {
      result.electron = injectElectronShim(bridge, electronOptions);
    }
  }

  if (options.wails) {
    Object.defineProperty(target, "wails", {
      get: () => options.wails,
      configurable: false,
    });
    result.wails = options.wails;
  }

  return result;
}
