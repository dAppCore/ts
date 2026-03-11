---
title: CoreTS
description: Go service that manages a Deno TypeScript runtime as a sandboxed sidecar process, providing permission-gated I/O over gRPC and Unix sockets.
---

# CoreTS

CoreTS (`forge.lthn.ai/core/ts`) is a Go package that embeds a **Deno TypeScript runtime** as a managed sidecar process. It provides a bidirectional communication bridge between Go and Deno over Unix sockets, with fine-grained permission gating for filesystem, key-value store, and process operations.

The Go side exposes a **CoreService** gRPC server that Deno calls for I/O. The Deno side exposes a **DenoService** JSON-RPC server that Go calls for module lifecycle management. TypeScript modules run in isolated Deno Workers with per-module permission sandboxing.

**Module path:** `forge.lthn.ai/core/ts`

**Licence:** EUPL-1.2

## Quick Start

Register CoreTS as a service in a Core application:

```go
import (
    "context"
    core "forge.lthn.ai/core/go/pkg/core"
    ts "forge.lthn.ai/core/ts"
)

opts := ts.Options{
    DenoPath:    "deno",
    SocketPath:  "/tmp/core/core.sock",
    AppRoot:     "/app",
    SidecarArgs: []string{"run", "-A", "--unstable-worker-options", "runtime/main.ts"},
}

app, err := core.New(core.WithService(ts.NewServiceFactory(opts)))
if err != nil {
    panic(err)
}
```

On startup, the service will:

1. Create a sandboxed I/O medium scoped to `AppRoot`
2. Open a SQLite-backed key-value store
3. Start a gRPC server on a Unix socket
4. Load and optionally verify the application manifest
5. Launch the Deno sidecar process
6. Wait for Deno's JSON-RPC server and connect as a client
7. Auto-load any previously installed marketplace modules

## Package Layout

| Path | Language | Purpose |
|------|----------|---------|
| `*.go` | Go | Sidecar management, gRPC server, permission checks, service integration |
| `proto/coredeno.proto` | Protobuf | Service definitions for CoreService and DenoService |
| `proto/*.pb.go` | Go | Generated protobuf and gRPC stubs |
| `runtime/main.ts` | TypeScript | Deno entry point -- boots the runtime, connects to Go |
| `runtime/client.ts` | TypeScript | gRPC client that calls CoreService on the Go side |
| `runtime/server.ts` | TypeScript | JSON-RPC server that implements DenoService for Go to call |
| `runtime/modules.ts` | TypeScript | Module registry with Worker isolation and I/O bridge |
| `runtime/worker-entry.ts` | TypeScript | Worker bootstrap -- loaded as entry point for every module Worker |
| `runtime/polyfill.ts` | TypeScript | Patches for Deno 2.x http2/grpc-js compatibility issues |
| `runtime/testdata/` | TypeScript | Test fixtures for integration tests |

## Go Source Files

| File | Purpose |
|------|---------|
| `coredeno.go` | `Options`, `Permissions`, `Sidecar` types and `NewSidecar()` constructor |
| `lifecycle.go` | `Sidecar.Start()`, `Stop()`, `IsRunning()` -- process lifecycle |
| `listener.go` | `ListenGRPC()` -- Unix socket gRPC listener with graceful shutdown |
| `server.go` | `Server` -- CoreService gRPC implementation with permission gating |
| `denoclient.go` | `DenoClient` -- JSON-RPC client for calling the Deno sidecar |
| `permissions.go` | `CheckPath()`, `CheckNet()`, `CheckRun()` -- permission helpers |
| `service.go` | `Service` -- framework integration (Startable/Stoppable lifecycle) |

## Dependencies

| Module | Purpose |
|--------|---------|
| `forge.lthn.ai/core/go` | Core framework (DI container, `ServiceRuntime`, lifecycle interfaces) |
| `forge.lthn.ai/core/go-io` | Sandboxed filesystem I/O (`Medium` interface, `MockMedium`) |
| `forge.lthn.ai/core/go-io/store` | SQLite-backed key-value store |
| `forge.lthn.ai/core/go-scm/manifest` | Module manifest loading and ed25519 verification |
| `forge.lthn.ai/core/go-scm/marketplace` | Module installation from Git repositories |
| `google.golang.org/grpc` | gRPC server and client |
| `google.golang.org/protobuf` | Protocol buffer runtime |
| `github.com/stretchr/testify` | Test assertions (dev only) |

The Deno runtime uses npm packages managed via `runtime/deno.json`:

| Package | Purpose |
|---------|---------|
| `@grpc/grpc-js` | gRPC client for calling CoreService |
| `@grpc/proto-loader` | Dynamic protobuf loading |

## Configuration

The `Options` struct controls all behaviour:

```go
type Options struct {
    DenoPath       string            // Path to deno binary (default: "deno")
    SocketPath     string            // Unix socket for Go's gRPC server
    DenoSocketPath string            // Unix socket for Deno's JSON-RPC server
    AppRoot        string            // Application root directory (sandboxed I/O boundary)
    StoreDBPath    string            // SQLite path (default: AppRoot/.core/store.db)
    PublicKey      ed25519.PublicKey  // Ed25519 key for manifest verification (optional)
    SidecarArgs    []string          // Arguments passed to the Deno process
}
```

If `SocketPath` is not set, it defaults to `$XDG_RUNTIME_DIR/core/deno.sock` (or `/tmp/core/deno.sock` on macOS).

If `DenoSocketPath` is not set, it defaults to the same directory as `SocketPath` with filename `deno.sock`.

If `StoreDBPath` is not set and `AppRoot` is provided, it defaults to `AppRoot/.core/store.db`.
