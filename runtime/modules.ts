// Module registry — manages module lifecycle with Deno Worker isolation.
// Each module runs in its own Worker with per-module permission sandboxing.
// I/O bridge relays Worker postMessage calls to CoreService gRPC.

import type { CoreClient } from "./client.ts";
import {
  type CoreRPCMethod,
  type CoreRPCParams,
  type IPCLoadedMessage,
  RuntimeHostBridge,
  type RuntimeIPCMessage,
} from "./ipc.ts";
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

  async load(
    code: string,
    entryPoint: string,
    permissions: ModulePermissions,
  ): Promise<LoadResult> {
    // Terminate existing worker if reloading
    const existingModule = this.modules.get(code);
    if (existingModule?.worker) {
      existingModule.worker.terminate();
    }
    if (existingModule?.loadWaiter) {
      existingModule.loadWaiter.resolve({
        ok: false,
        error: "module reloaded before previous initialisation completed",
      });
    }

    const loadWaiter = this.createLoadWaiter();
    const moduleState: Module = {
      code,
      entryPoint,
      permissions,
      status: "LOADING",
      loadWaiter,
    };
    this.modules.set(code, moduleState);

    // Resolve entry point URL for the module
    const moduleUrl = resolveModuleUrl(entryPoint);
    try {
      await assertModuleIsolation(entryPoint);
    } catch (error) {
      moduleState.status = "ERRORED";
      const message = error instanceof Error ? error.message : String(error);
      moduleState.loadWaiter?.resolve({ ok: false, error: message });
      moduleState.loadWaiter = undefined;
      return await loadWaiter.promise;
    }

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

    moduleState.worker = worker;

    // I/O bridge: relay Worker RPC to CoreClient
    const hostBridge = new RuntimeHostBridge(
      {
        post(message: RuntimeIPCMessage): void {
          worker.postMessage(message);
        },
      },
      {
        onReady() {
          worker.postMessage({ type: "load", url: moduleUrl });
        },
        onLoaded(message: IPCLoadedMessage) {
          moduleState.status = message.ok ? "RUNNING" : "ERRORED";
          if (message.ok) {
            console.error(`CoreDeno: module running: ${code}`);
            moduleState.loadWaiter?.resolve({ ok: true });
          } else {
            console.error(`CoreDeno: module error: ${code}: ${message.error}`);
            moduleState.loadWaiter?.resolve({
              ok: false,
              error: message.error ?? "module failed to load",
            });
          }
          moduleState.loadWaiter = undefined;
        },
        dispatch: async (
          method: CoreRPCMethod,
          params: CoreRPCParams[CoreRPCMethod],
        ) => {
          if (!this.coreClient) {
            throw new Error("CoreService client is not connected");
          }
          return await this.dispatchRPC(code, method, params);
        },
      },
    );

    worker.onmessage = async (e: MessageEvent) => {
      await hostBridge.handle(e.data as RuntimeIPCMessage);
    };

    worker.onerror = (e: ErrorEvent) => {
      moduleState.status = "ERRORED";
      console.error(`CoreDeno: worker error: ${code}: ${e.message}`);
      moduleState.loadWaiter?.resolve({ ok: false, error: e.message });
      moduleState.loadWaiter = undefined;
    };

    console.error(`CoreDeno: module loading: ${code}`);
    return loadWaiter.promise;
  }

  private async dispatchRPC(
    moduleCode: string,
    method: CoreRPCMethod,
    params: CoreRPCParams[CoreRPCMethod],
  ): Promise<unknown> {
    const c = this.coreClient!;
    switch (method) {
      case "LocaleGet":
        return c.localeGet((params as CoreRPCParams["LocaleGet"]).locale);
      case "StoreGet":
        params = params as CoreRPCParams["StoreGet"];
        return c.storeGet(
          params.group,
          params.key,
          moduleCode,
        );
      case "StoreSet":
        params = params as CoreRPCParams["StoreSet"];
        return c.storeSet(
          params.group,
          params.key,
          params.value,
          moduleCode,
        );
      case "FileRead":
        return c.fileRead(
          (params as CoreRPCParams["FileRead"]).path,
          moduleCode,
        );
      case "FileWrite":
        params = params as CoreRPCParams["FileWrite"];
        return c.fileWrite(
          params.path,
          params.content,
          moduleCode,
        );
      case "FileList":
        return c.fileList(
          (params as CoreRPCParams["FileList"]).path,
          moduleCode,
        );
      case "FileDelete":
        return c.fileDelete(
          (params as CoreRPCParams["FileDelete"]).path,
          moduleCode,
        );
      case "ProcessStart":
        params = params as CoreRPCParams["ProcessStart"];
        return c.processStart(
          params.command,
          params.args,
          moduleCode,
        );
      case "ProcessStop":
        return c.processStop(
          (params as CoreRPCParams["ProcessStop"]).process_id,
          moduleCode,
        );
      default:
        throw new Error(`unknown RPC method: ${method}`);
    }
  }

  unload(code: string): boolean {
    const moduleState = this.modules.get(code);
    if (!moduleState) return false;
    if (moduleState.loadWaiter) {
      moduleState.loadWaiter.resolve({
        ok: false,
        error: "module unloaded before initialisation completed",
      });
      moduleState.loadWaiter = undefined;
    }
    if (moduleState.worker) {
      moduleState.worker.terminate();
      moduleState.worker = undefined;
    }
    moduleState.status = "STOPPED";
    console.error(`CoreDeno: module unloaded: ${code}`);
    return true;
  }

  status(code: string): ModuleStatus {
    return this.modules.get(code)?.status ?? "UNKNOWN";
  }

  async reloadAll(): Promise<LoadResult[]> {
    const snapshot = Array.from(this.modules.values())
      .filter((moduleState) => moduleState.status !== "STOPPED")
      .map((moduleState) => ({
        code: moduleState.code,
        entryPoint: moduleState.entryPoint,
        permissions: moduleState.permissions,
      }));

    const results: LoadResult[] = [];
    for (const moduleState of snapshot) {
      results.push(
        await this.load(
          moduleState.code,
          moduleState.entryPoint,
          moduleState.permissions,
        ),
      );
    }
    return results;
  }

  list(): Array<{ code: string; status: ModuleStatus }> {
    return Array.from(this.modules.values()).map((moduleState) => ({
      code: moduleState.code,
      status: moduleState.status,
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

async function assertModuleIsolation(entryPoint: string): Promise<void> {
  const modulePath = resolveModulePath(entryPoint);
  if (!modulePath) {
    return;
  }

  try {
    const stat = await Deno.stat(modulePath);
    if (!stat.isFile) {
      return;
    }
  } catch {
    return;
  }

  const rootDir = dirname(modulePath);
  const visited = new Set<string>();
  await walkModuleGraph(modulePath, rootDir, visited);
}

async function walkModuleGraph(
  modulePath: string,
  rootDir: string,
  visited: Set<string>,
): Promise<void> {
  const normalisedPath = resolve(modulePath);
  if (visited.has(normalisedPath)) {
    return;
  }
  visited.add(normalisedPath);

  const source = await Deno.readTextFile(normalisedPath);
  for (const specifier of extractModuleSpecifiers(source)) {
    if (!isLocalModuleSpecifier(specifier)) {
      continue;
    }

    const resolvedPath = resolve(dirname(normalisedPath), specifier);
    if (!isWithinRoot(rootDir, resolvedPath)) {
      throw new Error(
        `module isolation violation: ${normalisedPath} imports ${specifier} outside ${rootDir}`,
      );
    }

    try {
      const stat = await Deno.stat(resolvedPath);
      if (stat.isFile) {
        await walkModuleGraph(resolvedPath, rootDir, visited);
      }
    } catch {
      // Ignore unresolved imports here; Deno will report ordinary module errors later.
    }
  }
}

function extractModuleSpecifiers(source: string): string[] {
  const pattern =
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"'`]+)["']|import\(\s*["']([^"'`]+)["']\s*\)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      matches.push(specifier);
    }
  }
  return matches;
}

function isLocalModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") ||
    specifier.startsWith("file://");
}

function isWithinRoot(rootDir: string, candidatePath: string): boolean {
  const normalisedRoot = resolve(rootDir);
  const normalisedCandidate = resolve(candidatePath);
  const prefix = normalisedRoot.endsWith("/") || normalisedRoot.endsWith("\\")
    ? normalisedRoot
    : `${normalisedRoot}/`;
  return normalisedCandidate === normalisedRoot ||
    normalisedCandidate.startsWith(prefix);
}
