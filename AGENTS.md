# AGENTS.md — core/ts

Primary references: `CLAUDE.md`, `docs/index.md`, `docs/development.md`, and `docs/architecture.md`.

## Identity

- Module: `dappco.re/go/core/ts`
- Product: CoreTS
- Purpose: manage a Deno 2.x TypeScript runtime as a sandboxed sidecar for Core applications
- Shape: library package only; no standalone binary lives in this repo

## Repo map

- `*.go` — sidecar lifecycle, gRPC server, permission checks, and service integration
- `runtime/` — Deno runtime entrypoint, JSON-RPC server, module registry, worker bootstrap, and test fixtures
- `proto/coredeno.proto` — source of truth for `CoreService` and `DenoService`
- `proto/*.pb.go` — generated Go protobuf and gRPC stubs
- `docs/` — overview, development workflow, and architecture notes

## Working rules

- Treat `go.mod` as the source of truth for the module path if older docs still reference the legacy `forge.lthn.ai` path.
- Keep changes library-focused and backwards-compatible for callers that embed this service into larger Core applications.
- Preserve the bidirectional contract between Go and Deno: Go exposes `CoreService`, Deno exposes `DenoService`.
- When editing `proto/coredeno.proto`, regenerate the Go stubs in the same change. Do not hand-edit generated `proto/*.pb.go` files.
- Keep Go permission checks, runtime worker permissions, and manifest-derived capabilities aligned.
- Use UK English in documentation and user-facing text.

## Build and test

```bash
go build ./...
go test ./...
go test -run TestName ./...
go test -tags integration -timeout 60s ./...
go test -race ./...
go test -cover ./...
go fmt ./...
go vet ./...
protoc --go_out=. --go-grpc_out=. proto/coredeno.proto
```

## Architecture notes

- All Go source stays in the `ts` package; avoid introducing subpackages unless there is a strong boundary reason.
- Startup flow is: create sandboxed medium, open store, start Unix-socket gRPC listener, launch sidecar, connect JSON-RPC client, then auto-load installed modules.
- Shutdown should unwind in reverse order and keep cleanup reliable on partial-start failures.
- `runtime/polyfill.ts` must remain loaded before `@grpc/grpc-js` imports.
- TypeScript modules run in isolated Deno Workers and use the postMessage bridge in `runtime/worker-entry.ts` and `runtime/modules.ts` for I/O back to Go.

## Go conventions

- Prefer wrapped errors with context, especially on startup and lifecycle paths.
- Keep secure defaults intact: empty permission lists deny access, reserved store groups prefixed with `_` stay blocked, and path checks must enforce directory boundaries.
- Respect existing socket lifecycle behaviour, including stale socket cleanup and owner-only permissions where applicable.
- Keep names descriptive and consistent with the current API surface (`Sidecar`, `Server`, `DenoClient`, `Service`, `Options`).

## Test conventions

- Follow the existing `_Good`, `_Bad`, and `_Ugly` suffix pattern for tests.
- Keep unit tests Deno-free where possible by using mocks and fixtures.
- Gate integration tests behind the `integration` build tag and allow them to skip cleanly when Deno is unavailable.
- Reuse `runtime/testdata/` for module fixtures instead of embedding ad hoc test modules inline.
