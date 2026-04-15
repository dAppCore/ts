---
title: Development
description: How to build, test, and contribute to CoreTS.
---

# Development

## Prerequisites

- **Go 1.26+** (uses Go workspaces)
- **Deno 2.x** (required for integration tests)
- **protoc** + Go/gRPC plugins (only if regenerating protobuf stubs)

This module is part of a Go workspace at `~/Code/go.work`. After cloning, ensure the workspace includes it:

```bash
go work use ./core/ts
```

## Building

CoreTS is a library package with no standalone binary. It compiles as part of applications that import it:

```bash
go build ./...
```

## Running Tests

### Unit Tests

Unit tests cover the Go side without requiring Deno:

```bash
core go test
# or
go test ./...
```

Tests use the `_Good`, `_Bad`, `_Ugly` suffix convention:
- `_Good` -- happy path
- `_Bad` -- expected error conditions
- `_Ugly` -- panics and edge cases

### Integration Tests

Integration tests require a working Deno installation and are gated behind the `integration` build tag:

```bash
go test -tags integration -timeout 60s ./...
```

These tests boot the full CoreTS stack (Go gRPC server + Deno sidecar + Workers) and verify end-to-end communication. They are organised in tiers:

| Tier | Test | What it proves |
|------|------|----------------|
| 1 | `TestIntegration_FullBoot_Good` | Go gRPC server starts, Deno sidecar launches, store round-trip works |
| 2 | `TestIntegration_Tier2_Bidirectional_Good` | Go can call Deno (LoadModule/UnloadModule/ModuleStatus), bidirectional communication |
| 3 | `TestIntegration_Tier3_WorkerIsolation_Good` | Module Workers can call back to Go via the I/O bridge (store write from inside a Worker) |
| 4 | `TestIntegration_Tier4_MarketplaceInstall_Good` | Full marketplace flow: install from Git, load module, verify I/O bridge, unload, remove |

If Deno is not installed, integration tests are automatically skipped.

### Single Test

```bash
core go test --run TestCheckPath_Good_Allowed
# or
go test -run TestCheckPath_Good_Allowed ./...
```

### Test Coverage

```bash
core go cov
core go cov --open    # Opens HTML report
```

## Code Quality

```bash
core go fmt     # Format
core go lint    # Lint
core go vet     # Vet
core go qa      # All of the above + tests
core go qa full # + race detector, vulnerability scan
```

## Regenerating Protobuf Stubs

If you modify `proto/coredeno.proto`, regenerate the Go stubs:

```bash
protoc --go_out=. --go-grpc_out=. proto/coredeno.proto
```

Ensure you have the `protoc-gen-go` and `protoc-gen-go-grpc` plugins installed:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

The Deno side loads the `.proto` file dynamically at runtime via `@grpc/proto-loader`, so no TypeScript code generation is needed.

## Project Structure

```
dappco.re/go/core/ts/
├── coredeno.go          # Options, Permissions, Sidecar types
├── coredeno_test.go     # Unit tests for options and sidecar creation
├── lifecycle.go         # Sidecar Start/Stop/IsRunning
├── lifecycle_test.go    # Unit tests for process lifecycle
├── listener.go          # ListenGRPC -- Unix socket gRPC server
├── listener_test.go     # Unit tests for gRPC listener
├── server.go            # CoreService gRPC implementation
├── server_test.go       # Unit tests for gRPC handlers + permissions
├── denoclient.go        # DenoClient JSON-RPC client
├── permissions.go       # CheckPath/CheckNet/CheckRun helpers
├── permissions_test.go  # Unit tests for permission checks
├── service.go           # Framework Service integration
├── service_test.go      # Unit tests for service lifecycle
├── integration_test.go  # End-to-end tests (build tag: integration)
├── go.mod
├── go.sum
├── proto/
│   ├── coredeno.proto       # Service + message definitions
│   ├── coredeno.pb.go       # Generated protobuf code
│   └── coredeno_grpc.pb.go  # Generated gRPC stubs
└── runtime/
    ├── main.ts              # Deno entry point
    ├── client.ts            # CoreService gRPC client (Deno calls Go)
    ├── server.ts            # DenoService JSON-RPC server (Go calls Deno)
    ├── modules.ts           # Module registry + Worker isolation
    ├── worker-entry.ts      # Worker bootstrap script
    ├── polyfill.ts          # Deno 2.x http2/grpc-js patches
    ├── deno.json            # Deno configuration + npm imports
    ├── deno.lock            # Lock file
    └── testdata/
        └── test-module.ts   # Test fixture for integration tests
src/
    ├── mod.ts               # Browser/runtime entry point
    ├── storage.ts           # Storage polyfills and bridge contracts
    ├── electron.ts          # Electron compatibility shim
    ├── router.ts            # Hash router with core:// handling
    ├── i18n.ts              # Shared i18n API
    ├── components.ts        # Web Component base classes
    ├── wasm.ts              # go-html WASM loader
    ├── events.ts            # Event bus
    ├── result.ts            # Result helpers
    └── options.ts           # Shared option types
```

## Writing a TypeScript Module

A module is a TypeScript file that exports an `init` function:

```typescript
export async function init(core: any) {
    // Use the I/O bridge to interact with Go-managed resources
    await core.storeSet("my-module", "status", "running");

    const data = await core.fileRead("./data/config.json");
    console.log("Config loaded:", data);
}
```

The `core` object provides:

| Method | Description |
|--------|-------------|
| `core.storeGet(group, key)` | Read from the key-value store |
| `core.storeSet(group, key, value)` | Write to the key-value store |
| `core.fileRead(path)` | Read a file (permission-gated) |
| `core.fileWrite(path, content)` | Write a file (permission-gated) |
| `core.processStart(command, args)` | Start a subprocess (permission-gated) |
| `core.processStop(processId)` | Stop a subprocess |

All operations are relayed through the Go gRPC server and checked against the module's declared permissions.

## Adding a New gRPC Method

1. Add the RPC and message definitions to `proto/coredeno.proto`
2. Regenerate Go stubs: `protoc --go_out=. --go-grpc_out=. proto/coredeno.proto`
3. Implement the handler in `server.go` with appropriate permission checks
4. Add the method to `runtime/client.ts` (CoreService calls) or `runtime/server.ts` (DenoService calls)
5. If the method should be available to Workers, add it to `runtime/worker-entry.ts` and `runtime/modules.ts` (`dispatchRPC`)
6. Write unit tests (`server_test.go`) and integration tests (`integration_test.go`)

## Coding Standards

- **UK English** in documentation and user-facing strings (colour, organisation, centre)
- **Strict typing** -- all Go function parameters and return types must be declared
- **Test naming** -- use `_Good`, `_Bad`, `_Ugly` suffixes
- **Error context** -- wrap errors with the subsystem prefix: `fmt.Errorf("coredeno: <context>: %w", err)`
- **Thread safety** -- use `sync.RWMutex` for shared state; the Sidecar and DenoClient are both thread-safe
- **Secure by default** -- empty permission lists deny all access; reserved store namespaces are blocked

## Dependency Graph

```
dappco.re/go/core/ts
├── dappco.re/go/core            (DI container, ServiceRuntime)
├── dappco.re/go/core/io         (Sandboxed Medium, MockMedium, Store)
├── dappco.re/go/core/scm        (Manifest loading, Marketplace installer)
├── google.golang.org/grpc       (gRPC server + client)
└── google.golang.org/protobuf   (Protocol buffer runtime)
```

CoreTS has no circular dependencies. It depends on the core framework but the framework does not depend on it.
