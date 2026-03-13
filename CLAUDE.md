# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CoreTS (`forge.lthn.ai/core/ts`) is a Go package that manages a Deno 2.x TypeScript runtime as a sandboxed sidecar process. It provides bidirectional communication between Go and Deno over Unix sockets using gRPC (Go→Deno calls) and JSON-RPC (Deno→Go calls), with fine-grained permission gating for filesystem, key-value store, and process operations.

This is a **library package** — no standalone binary. It compiles as part of applications that import it.

## Build & Test Commands

```bash
go build ./...                                # Build
go test ./...                                 # Unit tests (no Deno needed)
go test -tags integration -timeout 60s ./...  # Integration tests (requires Deno 2.x)
go test -run TestName ./...                   # Single test
go test -race ./...                           # Race detector
go test -cover ./...                          # Coverage

go fmt ./...                                  # Format
go vet ./...                                  # Vet

# Proto regeneration
protoc --go_out=. --go-grpc_out=. proto/coredeno.proto
```

## Architecture

All Go code lives in a single `ts` package (no subpackages).

**Two communication channels over Unix sockets:**
- **CoreService (gRPC)** — Go implements, Deno calls. Handles: FileRead/Write/List/Delete, StoreGet/Set, ProcessStart/Stop. Every call is permission-gated against the module's manifest.
- **DenoService (JSON-RPC)** — Deno implements, Go calls. Handles: LoadModule, UnloadModule, ModuleStatus. Newline-delimited JSON over raw Unix socket.

**Startup sequence:** Create sandboxed Medium → Open SQLite store → Start gRPC listener on Unix socket → Launch Deno sidecar (passes CORE_SOCKET/DENO_SOCKET env vars) → Connect DenoClient → Auto-load installed modules.

**Module isolation:** Each module runs in a Deno Worker. The I/O bridge pattern is: module calls core API → worker-entry intercepts via postMessage RPC → ModuleRegistry relays to CoreClient gRPC → Go Server checks permissions with injected module code → result returns through same chain.

### Key Go types
- `Options` — Configuration (DenoPath, SocketPath, AppRoot, etc.)
- `Sidecar` — Manages Deno child process lifecycle
- `Server` — CoreService gRPC implementation with permission gating
- `DenoClient` — JSON-RPC client for module lifecycle
- `Service` — Framework integration (Startable/Stoppable lifecycle)

### Key TypeScript files (runtime/)
- `main.ts` — Entry point, boots gRPC client + JSON-RPC server
- `modules.ts` — ModuleRegistry, Worker lifecycle management
- `client.ts` — CoreService gRPC client wrapper
- `server.ts` — DenoService JSON-RPC server
- `worker-entry.ts` — Worker bootstrap, I/O bridge to parent
- `polyfill.ts` — Deno 2.x http2/grpc-js compatibility fixes (must import before @grpc/grpc-js)

## Code Conventions

- **UK English** in docs and comments (colour, organisation)
- **Error wrapping:** `fmt.Errorf("coredeno: <context>: %w", err)`
- **Test naming:** `_Good`, `_Bad`, `_Ugly` suffixes for test functions
- **Thread safety:** `Sidecar` and `DenoClient` use `sync.RWMutex`
- **Security model:** Empty permission lists deny all access; reserved store namespaces (prefixed `_`) blocked from modules; path matching uses boundary checks to prevent `"data"` matching `"data-secrets"`

## Testing

- **Unit tests** run without Deno — use `MockMedium` and `mockProcessRunner`
- **Integration tests** require `//go:build integration` tag and Deno 2.x installed; tests skip gracefully via `findDeno()` if Deno is absent
- Integration tests are tiered: Tier 1 (boot), Tier 2 (bidirectional comms), Tier 3 (Worker isolation + I/O bridge), Tier 4 (marketplace install)

## Dependencies

- `forge.lthn.ai/core/go` — Core framework (DI, ServiceRuntime)
- `forge.lthn.ai/core/go-io` — Sandboxed filesystem Medium
- `forge.lthn.ai/core/go-io/store` — SQLite key-value store
- `forge.lthn.ai/core/go-scm` — Manifest loading + marketplace installer
- `google.golang.org/grpc` — gRPC transport
- Deno side uses `@grpc/grpc-js` and `@grpc/proto-loader` (npm imports via deno.json, no codegen needed)

## Proto

Source: `proto/coredeno.proto` defines both `CoreService` and `DenoService`. Go stubs are generated; Deno loads the `.proto` dynamically at runtime via `@grpc/proto-loader`.
