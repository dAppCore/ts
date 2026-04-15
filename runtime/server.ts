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
  // Remove stale socket
  try {
    Deno.removeSync(socketPath);
  } catch {
    // ignore
  }

  const listener = Deno.listen({ transport: "unix", path: socketPath });

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

async function dispatch(
  req: RPCRequest,
  registry: ModuleRegistry,
): Promise<Record<string, unknown>> {
  switch (req.method) {
    case "Ping":
      return { ok: true };
    case "LoadModule": {
      const result = await registry.load(
        req.code ?? "",
        req.entry_point ?? "",
        req.permissions ?? {},
      );
      return result as unknown as Record<string, unknown>;
    }
    case "UnloadModule": {
      const ok = registry.unload(req.code ?? "");
      return { ok };
    }
    case "ModuleStatus": {
      return { code: req.code, status: registry.status(req.code ?? "") };
    }
    default:
      return { error: `unknown method: ${req.method}` };
  }
}

function isJsonRpcRequest(req: RPCRequest): boolean {
  return req.jsonrpc === "2.0" || req.id !== undefined;
}

function formatResponse(
  req: RPCRequest,
  response: Record<string, unknown>,
): Record<string, unknown> {
  if (!isJsonRpcRequest(req)) {
    return response;
  }

  if (typeof response.error === "string") {
    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: {
        code: -32601,
        message: response.error,
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id: req.id ?? null,
    result: response,
  };
}
