---
title: Architecture
description: How CoreTS manages a Deno sidecar with bidirectional gRPC/JSON-RPC communication, Worker isolation, and permission-gated I/O.
---

# Architecture

CoreTS follows a **sidecar pattern**: a Go process manages a Deno child process, and the two communicate over Unix domain sockets. This gives TypeScript modules access to Go-managed resources (filesystem, store, processes) whilst enforcing security boundaries at every layer.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Go Process                                                      │
│                                                                 │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────────────┐ │
│  │ Service   │───▸│ Sidecar   │    │ Server (CoreService)     │ │
│  │ (OnStart/ │    │ Start()   │    │ FileRead/Write/List/Del  │ │
│  │  OnStop)  │    │ Stop()    │    │ StoreGet/Set             │ │
│  └──────────┘    └───────────┘    │ ProcessStart/Stop        │ │
│       │                            └──────────────────────────┘ │
│       │                                       ▲                 │
│       ▼                                       │ gRPC            │
│  ┌──────────┐                         ┌───────┴───────┐        │
│  │DenoClient│──JSON-RPC──┐            │ Unix Socket   │        │
│  └──────────┘            │            │ (core.sock)   │        │
│                          │            └───────────────┘        │
└──────────────────────────│────────────────────────────────────┘
                           │
               ┌───────────┴─────────────────────────────────────┐
               │ Deno Process                                     │
               │                                                  │
               │  ┌────────────┐    ┌──────────────────────────┐ │
               │  │ CoreClient │───▸│ Go gRPC Server           │ │
               │  │ (gRPC)     │    │ (via core.sock)          │ │
               │  └────────────┘    └──────────────────────────┘ │
               │                                                  │
               │  ┌──────────────┐  ┌──────────────────────────┐ │
               │  │ DenoServer   │◂─│ Go DenoClient            │ │
               │  │ (JSON-RPC)   │  │ (via deno.sock)          │ │
               │  └──────────────┘  └──────────────────────────┘ │
               │                                                  │
               │  ┌──────────────────────────────────────────┐   │
               │  │ ModuleRegistry                           │   │
               │  │  ┌────────┐  ┌────────┐  ┌────────┐     │   │
               │  │  │Worker A│  │Worker B│  │Worker C│ ... │   │
               │  │  └────────┘  └────────┘  └────────┘     │   │
               │  └──────────────────────────────────────────┘   │
               └──────────────────────────────────────────────────┘
```

## Key Types

### Options

Configuration struct passed to `NewSidecar()` and `NewServiceFactory()`. Controls paths, security keys, and sidecar arguments. See [index.md](index.md#configuration) for field descriptions.

### Sidecar

Manages the Deno child process. Thread-safe via `sync.RWMutex`.

```go
type Sidecar struct {
    opts   Options
    mu     sync.RWMutex
    cmd    *exec.Cmd
    ctx    context.Context
    cancel context.CancelFunc
    done   chan struct{}
}
```

- `Start(ctx, args...)` -- launches `deno <args>` with `CORE_SOCKET` and `DENO_SOCKET` environment variables injected. Creates the socket directory with `0700` permissions. A background goroutine monitors the process and signals `done` on exit.
- `Stop()` -- cancels the context and blocks until the process exits.
- `IsRunning()` -- returns whether the child process is alive.

The sidecar refuses to start twice (returns an error if already running) and cleans up stale socket files before launch.

### Server (CoreService)

Implements the `CoreService` gRPC interface. Every I/O operation is gated by the calling module's declared permissions from its manifest.

```go
type Server struct {
    pb.UnimplementedCoreServiceServer
    medium    io.Medium        // Sandboxed filesystem
    store     *store.Store     // SQLite key-value store
    manifests map[string]*manifest.Manifest
    processes ProcessRunner    // Optional process management
}
```

**gRPC methods:**

| Method | Permission check | Description |
|--------|-----------------|-------------|
| `FileRead` | `CheckPath(path, manifest.Read)` | Read file content |
| `FileWrite` | `CheckPath(path, manifest.Write)` | Write file content |
| `FileList` | `CheckPath(path, manifest.Read)` | List directory entries |
| `FileDelete` | `CheckPath(path, manifest.Write)` | Delete a file |
| `StoreGet` | Reserved namespace (`_` prefix blocked) | Get a key-value pair |
| `StoreSet` | Reserved namespace (`_` prefix blocked) | Set a key-value pair |
| `ProcessStart` | `CheckRun(cmd, manifest.Run)` | Start a subprocess |
| `ProcessStop` | None (by process ID) | Stop a subprocess |

Store groups prefixed with `_` (e.g. `_coredeno`, `_modules`) are reserved for internal use and blocked from module access.

### DenoClient

Communicates with the Deno sidecar's JSON-RPC server over a Unix socket. Thread-safe via mutex (serialises requests over a single connection).

```go
type DenoClient struct {
    mu     sync.Mutex
    conn   net.Conn
    reader *bufio.Reader
}
```

**Methods:**
- `LoadModule(code, entryPoint, perms)` -- tells Deno to create a Worker for the module
- `UnloadModule(code)` -- terminates the module's Worker
- `ModuleStatus(code)` -- queries whether a module is LOADING, RUNNING, STOPPED, or ERRORED

The wire protocol is newline-delimited JSON over a raw Unix socket.

### Service

Wraps everything into a Core framework service with `Startable` and `Stoppable` lifecycle interfaces.

```go
type Service struct {
    *core.ServiceRuntime[Options]
    sidecar    *Sidecar
    grpcServer *Server
    store      *store.Store
    grpcCancel context.CancelFunc
    grpcDone   chan error
    denoClient *DenoClient
    installer  *marketplace.Installer
}
```

Register with the framework:

```go
core.New(core.WithService(ts.NewServiceFactory(opts)))
```

### Permissions

Three helper functions implement the permission model:

```go
// Prefix-based path matching with directory boundary checks.
// Empty allowed list = deny all (secure by default).
func CheckPath(path string, allowed []string) bool

// Exact match against allowed host:port list.
func CheckNet(addr string, allowed []string) bool

// Exact match against allowed command list.
func CheckRun(cmd string, allowed []string) bool
```

`CheckPath` cleans paths via `filepath.Clean` and verifies the separator boundary to prevent `"data"` from matching `"data-secrets"`.

## Startup Sequence

The `Service.OnStartup()` method orchestrates the full boot in order:

1. **Create sandboxed Medium** -- `io.NewSandboxed(AppRoot)` confines all filesystem operations to the application root. Falls back to `MockMedium` if no `AppRoot` is set.

2. **Open SQLite store** -- `store.New(dbPath)` opens the key-value database. Uses `:memory:` if no path is configured.

3. **Create gRPC server** -- `NewServer(medium, store)` wires up the CoreService implementation.

4. **Load manifest** -- reads `.core/view.yml` from `AppRoot`. If a `PublicKey` is configured, the manifest must pass ed25519 signature verification before being registered. Missing manifests are non-fatal.

5. **Start gRPC listener** -- `ListenGRPC()` runs in a background goroutine. Cleans up stale socket files, listens on a Unix socket, and sets `0600` permissions (owner-only).

6. **Launch sidecar** -- waits up to 5 seconds for the core socket to appear, then calls `Sidecar.Start()`. The child process receives `CORE_SOCKET` and `DENO_SOCKET` environment variables.

7. **Connect DenoClient** -- waits up to 10 seconds for the Deno socket to appear, then dials the JSON-RPC connection.

8. **Auto-load installed modules** -- if `AppRoot` is set, creates a `marketplace.Installer` and iterates over previously installed modules, calling `DenoClient.LoadModule()` for each.

If any step fails, earlier resources are cleaned up (gRPC listener cancelled, sidecar stopped) before the error is returned.

## Shutdown Sequence

`Service.OnShutdown()` tears down in reverse order:

1. Close the DenoClient connection
2. Stop the sidecar process (cancel context, wait for exit)
3. Cancel the gRPC listener context and wait for graceful stop
4. Close the SQLite store

## Deno Runtime Internals

### Entry Point (`runtime/main.ts`)

The Deno process boots through `main.ts`:

1. Reads `CORE_SOCKET` and `DENO_SOCKET` from environment (exits fatally if missing)
2. Creates a `ModuleRegistry`
3. Starts the DenoService JSON-RPC server on `DENO_SOCKET`
4. Connects to the Go CoreService gRPC server on `CORE_SOCKET` with retry (up to 20 attempts, 250ms apart)
5. Verifies connectivity by writing and reading back a health check value
6. Injects the CoreClient into the registry for I/O bridging
7. Listens for `SIGTERM` to initiate clean shutdown

### CoreClient (`runtime/client.ts`)

A gRPC client that dynamically loads the protobuf definition from `proto/coredeno.proto`. Provides typed methods for all CoreService operations (file read/write/list/delete, store get/set, process start/stop).

### DenoServer (`runtime/server.ts`)

A JSON-RPC server over a raw Unix socket (not gRPC -- Deno 2.x has broken http2 server support). Accepts newline-delimited JSON and dispatches to the ModuleRegistry:

- `LoadModule` -- create a Worker for a module
- `UnloadModule` -- terminate a module's Worker
- `ModuleStatus` -- query a module's current state

### ModuleRegistry (`runtime/modules.ts`)

Manages the lifecycle of TypeScript modules. Each module runs in its own Deno Worker with a tailored permission sandbox.

**Module states:** `UNKNOWN` | `LOADING` | `RUNNING` | `STOPPED` | `ERRORED`

When `load()` is called:

1. Any existing Worker for that module code is terminated
2. A new Worker is created from `worker-entry.ts` with Deno permissions derived from the module's declared permissions (read, write, net, run). Environment, system, and FFI access are always denied.
3. The Worker signals `ready`, and the registry responds with `{type: "load", url: "..."}` containing the module's entry point URL
4. The Worker dynamically imports the module and calls its `init(core)` function
5. The Worker signals `loaded` with success or error status

**I/O bridge:** Worker `postMessage` RPC calls are intercepted by the registry and relayed to the CoreClient. The registry injects the module's `code` into every gRPC call, so modules cannot spoof their identity.

### Worker Entry (`runtime/worker-entry.ts`)

The bootstrap script loaded as entry point for every module Worker. It:

1. Sets up request/response correlation for the postMessage-based RPC bridge
2. Exposes a `core` object with typed methods (`storeGet`, `storeSet`, `fileRead`, `fileWrite`, `processStart`, `processStop`)
3. Signals `ready` to the parent
4. On receiving `{type: "load"}`, dynamically imports the module URL and calls `init(core)` if the export exists

### Polyfill (`runtime/polyfill.ts`)

Must be imported before `@grpc/grpc-js`. Patches three Deno 2.x Node.js compatibility issues:

1. `http2.getDefaultSettings` is not implemented -- provides a stub
2. Already-connected Unix sockets never emit `connect`, causing http2 session hangs -- intercepts `net.connect` to create fresh sockets
3. Deno's http2 client never fires `remoteSettings` -- emits it synthetically after `connect`

## Browser Runtime Package

The browser-side CoreTS library lives in `src/` and is exported from `src/mod.ts`. It is separate from the Deno sidecar runtime under `runtime/`.

The browser package provides:

- `events.ts` -- event bus primitives shared by the browser runtime
- `result.ts` -- `ok` / `err` result helpers
- `options.ts` -- shared runtime options shape
- `i18n.ts` -- stable translation helpers (`_`, `T`, `S`)
- `components.ts` -- Web Component base classes and registration helpers
- `wasm.ts` -- go-html WASM loading helpers
- `router.ts` -- hash router with `core://` scheme handling
- `storage.ts` -- storage, cookie, cache, bucket, and OPFS polyfills
- `electron.ts` -- Electron compatibility shim and `require()` proxy

These modules are designed for injection into a WebView before page JavaScript runs, which keeps browser runtime behaviour aligned with the RFC's CoreGUI integration model.

## Module Manifest

Modules declare their identity and permissions in `.core/view.yml`:

```yaml
code: my-module
name: My Module
version: "1.0"
permissions:
  read: ["./data/"]
  write: ["./data/"]
  net: ["api.example.com:443"]
  run: ["ffmpeg"]
```

The manifest is loaded by `go-scm/manifest.Load()` and optionally verified with an ed25519 public key. Permissions from the manifest are enforced by the Go gRPC server on every I/O request.

## Marketplace Integration

When `AppRoot` is set, the service creates a `marketplace.Installer` backed by the `modules/` subdirectory. Modules are installed from Git repositories via `Installer.Install()` and automatically loaded into the Deno runtime on boot.

The marketplace flow:

1. `Installer.Install(ctx, module)` -- clones the Git repo into `AppRoot/modules/<code>/`
2. On next boot, `Service.OnStartup()` calls `Installer.Installed()` and loads each module
3. `DenoClient.LoadModule()` creates a Worker with the module's declared permissions
4. `Installer.Remove(code)` -- removes the module directory from disk

## Security Model

CoreTS enforces security at multiple layers:

- **Filesystem sandboxing** -- the `io.Medium` is scoped to `AppRoot`; no path escapes are possible
- **Permission gating** -- every gRPC call checks the module's manifest permissions before executing
- **Prefix matching with boundary checks** -- `CheckPath` prevents `"data"` from matching `"data-secrets"`
- **Reserved store namespaces** -- groups prefixed with `_` are blocked from module access
- **Worker isolation** -- each TypeScript module runs in its own Deno Worker with restricted permissions (no env, sys, or FFI access)
- **Identity injection** -- the Go side (via the ModuleRegistry I/O bridge) injects the module code into every gRPC call; modules cannot impersonate each other
- **Socket permissions** -- Unix sockets are created with `0600` (owner-only) and socket directories with `0700`
- **Manifest verification** -- optional ed25519 signature verification before registering a module
