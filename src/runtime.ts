import {
  injectElectronShim,
  type ElectronBridge,
  type ElectronShim,
  type ElectronShimOptions,
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
  sessionId?: string;
  target?: Record<string, unknown>;
}

export interface CoreRuntimeInjection {
  storage?: CoreStoragePolyfills;
  electron?: ElectronShim;
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

  if (options.electron) {
    const electronOptions: ElectronShimOptions = { target };
    result.electron = injectElectronShim(options.electron, electronOptions);
  }

  return result;
}
