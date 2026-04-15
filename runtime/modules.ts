// Module registry — manages module lifecycle with Deno Worker isolation.
// Each module runs in its own Worker with per-module permission sandboxing.
// I/O bridge relays Worker postMessage calls to CoreService gRPC.

import type { CoreClient } from "./client.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ModuleStatus =
  | "UNKNOWN"
  | "LOADING"
  | "RUNNING"
  | "STOPPED"
  | "ERRORED";

export interface ModuleWorkerOptions extends WorkerOptions {
  deno?: {
    permissions?: {
      read?: string[];
      write?: string[];
      net?: string[];
      run?: string[];
      env?: boolean;
      sys?: boolean;
      ffi?: boolean;
    };
  };
}

export type ModuleWorkerFactory = (
  scriptUrl: string,
  options: ModuleWorkerOptions,
) => Worker;

export interface ModuleRegistryOptions {
  workerFactory?: ModuleWorkerFactory;
}

export interface ModulePermissions {
  read?: string[];
  write?: string[];
  net?: string[];
  run?: string[];
}

interface Module {
  code: string;
  entryPoint: string;
  permissions: ModulePermissions;
  status: ModuleStatus;
  worker?: Worker;
  loadWaiter?: LoadWaiter;
}

interface LoadWaiter {
  resolve(value: LoadResult): void;
  promise: Promise<LoadResult>;
}

export interface LoadResult {
  ok: boolean;
  error?: string;
}

export class ModuleRegistry {
  private modules = new Map<string, Module>();
  private coreClient: CoreClient | null = null;
  private workerEntryUrl: string;

  constructor(private readonly options: ModuleRegistryOptions = {}) {
    this.workerEntryUrl = new URL("./worker-entry.ts", import.meta.url).href;
  }

  setCoreClient(client: CoreClient): void {
    this.coreClient = client;
  }

  load(code: string, entryPoint: string, permissions: ModulePermissions): Promise<LoadResult> {
    // Terminate existing worker if reloading
    const existing = this.modules.get(code);
    if (existing?.worker) {
      existing.worker.terminate();
    }
    if (existing?.loadWaiter) {
      existing.loadWaiter.resolve({
        ok: false,
        error: "module reloaded before previous initialisation completed",
      });
    }

    const loadWaiter = this.createLoadWaiter();
    const mod: Module = {
      code,
      entryPoint,
      permissions,
      status: "LOADING",
      loadWaiter,
    };
    this.modules.set(code, mod);

    // Resolve entry point URL for the module
    const moduleUrl = resolveModuleUrl(entryPoint);

    // Build read permissions: worker-entry.ts dir + module source + declared reads
    const readPerms: string[] = [
      fileURLToPath(new URL(".", import.meta.url)),
    ];
    // Add the module's directory so it can be dynamically imported
    const modulePath = resolveModulePath(entryPoint);
    if (modulePath) {
      readPerms.push(dirname(modulePath));
    }
    if (permissions.read) readPerms.push(...permissions.read);

    // Create Worker with permission sandbox
    const workerOptions: ModuleWorkerOptions = {
      type: "module",
      name: code,
      // deno-lint-ignore no-explicit-any
      deno: {
        permissions: {
          read: readPerms,
          write: permissions.write ?? [],
          net: permissions.net ?? [],
          run: permissions.run ?? [],
          env: false,
          sys: false,
          ffi: false,
        },
      },
    };

    const worker = this.options.workerFactory
      ? this.options.workerFactory(this.workerEntryUrl, workerOptions)
      : new Worker(this.workerEntryUrl, workerOptions);

    mod.worker = worker;

    // I/O bridge: relay Worker RPC to CoreClient
    worker.onmessage = async (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === "ready") {
        worker.postMessage({ type: "load", url: moduleUrl });
        return;
      }

      if (msg.type === "loaded") {
        mod.status = msg.ok ? "RUNNING" : "ERRORED";
        if (msg.ok) {
          console.error(`CoreDeno: module running: ${code}`);
          mod.loadWaiter?.resolve({ ok: true });
        } else {
          console.error(`CoreDeno: module error: ${code}: ${msg.error}`);
          mod.loadWaiter?.resolve({ ok: false, error: msg.error ?? "module failed to load" });
        }
        mod.loadWaiter = undefined;
        return;
      }

      if (msg.type === "rpc" && this.coreClient) {
        try {
          const result = await this.dispatchRPC(
            code,
            msg.method,
            msg.params,
          );
          worker.postMessage({ type: "rpc_response", id: msg.id, result });
        } catch (err) {
          worker.postMessage({
            type: "rpc_response",
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (msg.type === "rpc") {
        worker.postMessage({
          type: "rpc_response",
          id: msg.id,
          error: "CoreService client is not connected",
        });
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      mod.status = "ERRORED";
      console.error(`CoreDeno: worker error: ${code}: ${e.message}`);
      mod.loadWaiter?.resolve({ ok: false, error: e.message });
      mod.loadWaiter = undefined;
    };

    console.error(`CoreDeno: module loading: ${code}`);
    return loadWaiter.promise;
  }

  private async dispatchRPC(
    moduleCode: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const c = this.coreClient!;
    switch (method) {
      case "LocaleGet":
        return c.localeGet(params.locale as string);
      case "StoreGet":
        return c.storeGet(
          params.group as string,
          params.key as string,
          moduleCode,
        );
      case "StoreSet":
        return c.storeSet(
          params.group as string,
          params.key as string,
          params.value as string,
          moduleCode,
        );
      case "FileRead":
        return c.fileRead(params.path as string, moduleCode);
      case "FileWrite":
        return c.fileWrite(
          params.path as string,
          params.content as string,
          moduleCode,
        );
      case "FileList":
        return c.fileList(params.path as string, moduleCode);
      case "FileDelete":
        return c.fileDelete(params.path as string, moduleCode);
      case "ProcessStart":
        return c.processStart(
          params.command as string,
          params.args as string[],
          moduleCode,
        );
      case "ProcessStop":
        return c.processStop(params.process_id as string, moduleCode);
      default:
        throw new Error(`unknown RPC method: ${method}`);
    }
  }

  unload(code: string): boolean {
    const mod = this.modules.get(code);
    if (!mod) return false;
    if (mod.loadWaiter) {
      mod.loadWaiter.resolve({
        ok: false,
        error: "module unloaded before initialisation completed",
      });
      mod.loadWaiter = undefined;
    }
    if (mod.worker) {
      mod.worker.terminate();
      mod.worker = undefined;
    }
    mod.status = "STOPPED";
    console.error(`CoreDeno: module unloaded: ${code}`);
    return true;
  }

  status(code: string): ModuleStatus {
    return this.modules.get(code)?.status ?? "UNKNOWN";
  }

  async reloadAll(): Promise<LoadResult[]> {
    const snapshot = Array.from(this.modules.values())
      .filter((mod) => mod.status !== "STOPPED")
      .map((mod) => ({
        code: mod.code,
        entryPoint: mod.entryPoint,
        permissions: mod.permissions,
      }));

    const results: LoadResult[] = [];
    for (const mod of snapshot) {
      results.push(await this.load(mod.code, mod.entryPoint, mod.permissions));
    }
    return results;
  }

  list(): Array<{ code: string; status: ModuleStatus }> {
    return Array.from(this.modules.values()).map((m) => ({
      code: m.code,
      status: m.status,
    }));
  }

  private createLoadWaiter(): LoadWaiter {
    let resolve!: (value: LoadResult) => void;
    const promise = new Promise<LoadResult>((res) => {
      resolve = res;
    });
    return { resolve, promise };
  }
}

function resolveModuleUrl(entryPoint: string): string {
  if (
    entryPoint.startsWith("file://") ||
    entryPoint.startsWith("http://") ||
    entryPoint.startsWith("https://")
  ) {
    return entryPoint;
  }

  return pathToFileURL(resolve(Deno.cwd(), entryPoint)).href;
}

function resolveModulePath(entryPoint: string): string | null {
  if (entryPoint.startsWith("http://") || entryPoint.startsWith("https://")) {
    return null;
  }
  if (entryPoint.startsWith("file://")) {
    return fileURLToPath(entryPoint);
  }
  return resolve(Deno.cwd(), entryPoint);
}
