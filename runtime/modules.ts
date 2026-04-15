// Module registry — manages module lifecycle with Deno Worker isolation.
// Each module runs in its own Worker with per-module permission sandboxing.
// I/O bridge relays Worker postMessage calls to CoreService gRPC.

import type { CoreClient } from "./client.ts";

export type ModuleStatus =
  | "UNKNOWN"
  | "LOADING"
  | "RUNNING"
  | "STOPPED"
  | "ERRORED";

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
}

export class ModuleRegistry {
  private modules = new Map<string, Module>();
  private coreClient: CoreClient | null = null;
  private workerEntryUrl: string;

  constructor() {
    this.workerEntryUrl = new URL("./worker-entry.ts", import.meta.url).href;
  }

  setCoreClient(client: CoreClient): void {
    this.coreClient = client;
  }

  load(code: string, entryPoint: string, permissions: ModulePermissions): void {
    // Terminate existing worker if reloading
    const existing = this.modules.get(code);
    if (existing?.worker) {
      existing.worker.terminate();
    }

    const mod: Module = {
      code,
      entryPoint,
      permissions,
      status: "LOADING",
    };
    this.modules.set(code, mod);

    // Resolve entry point URL for the module
    const moduleUrl =
      entryPoint.startsWith("file://") || entryPoint.startsWith("http")
        ? entryPoint
        : "file://" + entryPoint;

    // Build read permissions: worker-entry.ts dir + module source + declared reads
    const readPerms: string[] = [
      new URL(".", import.meta.url).pathname,
    ];
    // Add the module's directory so it can be dynamically imported
    if (!entryPoint.startsWith("http")) {
      const modPath = entryPoint.startsWith("file://")
        ? entryPoint.slice(7)
        : entryPoint;
      // Add the module file's directory
      const lastSlash = modPath.lastIndexOf("/");
      if (lastSlash > 0) readPerms.push(modPath.slice(0, lastSlash + 1));
      else readPerms.push(modPath);
    }
    if (permissions.read) readPerms.push(...permissions.read);

    // Create Worker with permission sandbox
    const worker = new Worker(this.workerEntryUrl, {
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
    } as any);

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
        } else {
          console.error(`CoreDeno: module error: ${code}: ${msg.error}`);
        }
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
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      mod.status = "ERRORED";
      console.error(`CoreDeno: worker error: ${code}: ${e.message}`);
    };

    console.error(`CoreDeno: module loading: ${code}`);
  }

  private async dispatchRPC(
    moduleCode: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const c = this.coreClient!;
    switch (method) {
      case "StoreGet":
        return c.storeGet(params.group as string, params.key as string);
      case "StoreSet":
        return c.storeSet(
          params.group as string,
          params.key as string,
          params.value as string,
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

  list(): Array<{ code: string; status: ModuleStatus }> {
    return Array.from(this.modules.values()).map((m) => ({
      code: m.code,
      status: m.status,
    }));
  }
}
