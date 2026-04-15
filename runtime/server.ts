// DenoService JSON-RPC server — Go calls Deno for module lifecycle management.
// Uses length-prefixed JSON over raw Unix socket (Deno's http2 server is broken).
// Protocol: 4-byte big-endian length + JSON payload, newline-delimited.

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
            const resp = dispatch(req, registry);
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
  method: string;
  code?: string;
  entry_point?: string;
  permissions?: { read?: string[]; write?: string[]; net?: string[]; run?: string[] };
  process_id?: string;
}

function dispatch(
  req: RPCRequest,
  registry: ModuleRegistry,
): Record<string, unknown> {
  switch (req.method) {
    case "Ping":
      return { ok: true };
    case "LoadModule": {
      registry.load(
        req.code ?? "",
        req.entry_point ?? "",
        req.permissions ?? {},
      );
      return { ok: true, error: "" };
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
