// DenoService JSON-RPC server — Go calls Deno for module lifecycle management.
// Uses newline-delimited JSON over a raw Unix socket (Deno's http2 server is broken).
// Requests may be legacy CoreTS envelopes or JSON-RPC 2.0 objects.

import { ModuleRegistry } from "./modules.ts";

export interface DenoServer {
  close(): void;
}

export async function startDenoServer(
  socketPath: string,
  registry: ModuleRegistry,
): Promise<DenoServer> {
  const socketDir = socketPath.includes("/")
    ? socketPath.slice(0, socketPath.lastIndexOf("/"))
    : "";

  // Remove stale socket
  try {
    Deno.removeSync(socketPath);
  } catch {
    // ignore
  }

  if (socketDir) {
    await Deno.mkdir(socketDir, { recursive: true, mode: 0o700 });
    try {
      await Deno.chmod(socketDir, 0o700);
    } catch {
      // best-effort on platforms that do not support chmod for unix socket dirs
    }
  }

  const listener = Deno.listen({ transport: "unix", path: socketPath });
  try {
    await Deno.chmod(socketPath, 0o600);
  } catch {
    // best-effort on platforms that do not support chmod for unix sockets
  }

  const handleConnection = async (conn: Deno.UnixConn) => {
    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (newline-delimited JSON)
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);

          if (!line.trim()) continue;

          try {
            const req = JSON.parse(line);
            const resp = formatResponse(req, await dispatch(req, registry));
            await writer.write(
              new TextEncoder().encode(JSON.stringify(resp) + "\n"),
            );
          } catch (err) {
            const errResp = {
              error: err instanceof Error ? err.message : String(err),
            };
            await writer.write(
              new TextEncoder().encode(JSON.stringify(errResp) + "\n"),
            );
          }
        }
      }
    } catch {
      // Connection closed or error — expected during shutdown
    } finally {
      try {
        writer.close();
      } catch {
        /* already closed */
      }
    }
  };

  // Accept connections in background
  const abortController = new AbortController();
  (async () => {
    try {
      for await (const conn of listener) {
        if (abortController.signal.aborted) break;
        handleConnection(conn);
      }
    } catch {
      // Listener closed
    }
  })();

  return {
    close() {
      abortController.abort();
      listener.close();
    },
  };
}

interface RPCRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
  code?: string;
  entry_point?: string;
  permissions?: {
    read?: string[];
    write?: string[];
    net?: string[];
    run?: string[];
  };
  process_id?: string;
}

interface RPCError {
  code: number;
  message: string;
}

interface RPCDispatchResponse {
  error?: RPCError;
  [key: string]: unknown;
}

async function dispatch(
  req: RPCRequest,
  registry: ModuleRegistry,
): Promise<RPCDispatchResponse> {
  const params = req.params ?? {};

  switch (req.method) {
    case "Ping":
      return { ok: true };
    case "LoadModule": {
      const loadParams = params as {
        code?: string;
        entry_point?: string;
        permissions?: {
          read?: string[];
          write?: string[];
          net?: string[];
          run?: string[];
        };
      };
      if (!isNonEmpty(loadParams.code ?? req.code)) {
        return invalidParams("module code required");
      }
      if (!isNonEmpty(loadParams.entry_point ?? req.entry_point)) {
        return invalidParams("module entry point required");
      }
      const result = await registry.load(
        loadParams.code ?? req.code ?? "",
        loadParams.entry_point ?? req.entry_point ?? "",
        loadParams.permissions ?? req.permissions ?? {},
      );
      return result as unknown as Record<string, unknown>;
    }
    case "UnloadModule": {
      const unloadParams = params as { code?: string };
      if (!isNonEmpty(unloadParams.code ?? req.code)) {
        return invalidParams("module code required");
      }
      const ok = registry.unload(unloadParams.code ?? req.code ?? "");
      return { ok };
    }
    case "ModuleStatus": {
      const statusParams = params as { code?: string };
      const code = statusParams.code ?? req.code ?? "";
      if (!isNonEmpty(code)) {
        return invalidParams("module code required");
      }
      return { code, status: registry.status(code) };
    }
    case "ReloadModules": {
      const results = await registry.reloadAll();
      return {
        ok: results.every((result) => result.ok),
        results,
      };
    }
    default:
      return methodNotFound(`unknown method: ${req.method}`);
  }
}

function isJsonRpcRequest(req: RPCRequest): boolean {
  return req.jsonrpc === "2.0" || req.id !== undefined;
}

function formatResponse(
  req: RPCRequest,
  response: RPCDispatchResponse,
): Record<string, unknown> {
  if (!isJsonRpcRequest(req)) {
    if (response.error) {
      return { error: response.error.message };
    }
    return response;
  }

  if (response.error) {
    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: {
        code: response.error.code,
        message: response.error.message,
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id: req.id ?? null,
    result: response,
  };
}

function invalidParams(message: string): RPCDispatchResponse {
  return {
    error: {
      code: -32602,
      message,
    },
  };
}

function methodNotFound(message: string): RPCDispatchResponse {
  return {
    error: {
      code: -32601,
      message,
    },
  };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
