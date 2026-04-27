---
module: core/ts
repo: core/ts
lang: ts
tier: lib
depends:
  - code/core/app
  - code/core/network
tags:
  - typescript
  - runtime
  - polyglot
  - components
  - webcomponents
---

# CoreTS RFC — TypeScript Runtime for the Core Ecosystem

> The authoritative spec for the TypeScript layer of the Core polyglot framework.
> An agent should be able to implement any component from this document alone.

**Heritage:** dAppServer (Deno 1.8, 20 repos, 73 endpoints), core-element-template (Angular+Tailwind)
**Runtime:** Deno (not Node — sandboxed by design)
**Repository:** `dappco.re/ts`, `core-deno/` (sidecar runtime)
**Related:** `code/core/app/RFC.md` (CoreApp spec)

---

## 1. Overview

CoreTS is the TypeScript implementation of the Core framework, running on Deno. It serves three roles:

1. **CoreDeno sidecar** — sandboxed runtime managed by CoreGO, providing module loading, I/O fortress, and dev toolchain
2. **Browser runtime** — Web Components, WASM interop, and the client-side application shell
3. **Standalone CLI** — TypeScript-native commands and tools that don't need Go

### 1.1 Why Deno, Not Node

| Property | Node | Deno |
|----------|------|------|
| Permissions | Everything allowed | Deny by default |
| Module loading | npm, node_modules | URL imports, import maps |
| TypeScript | Needs build step | Native |
| Security | Trust-based | Capability-based |
| Single binary | No | Yes |

Deno's permission model IS the I/O fortress. A module requesting access outside its declared paths is denied at the runtime level — no wrapper needed.

### 1.2 The Polyglot Stack

```
CoreGO  (Go)         — framework backbone, lifecycle, I/O, services
CoreTS  (TypeScript)  — browser runtime, module sandbox, dev toolchain
CorePHP (PHP)         — web platform, multi-tenant monolith
```

Each language gets first-class status. CoreGO is the host process. CoreTS runs as a sidecar or standalone. CorePHP runs as a web server. All share the same conventions, IPC patterns, and i18n format.

---

## 2. Architecture

### 2.1 CoreDeno Sidecar (Managed by CoreGO)

```
┌─────────────────────────────────────────────┐
│              WebView2 (Browser)             │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐ │
│  │  App Shell │  │ Web Comp │  │ go-html  │ │
│  │  (CoreTS)  │  │ (modules)│  │  WASM    │ │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘ │
│        └──────┬───────┘             │       │
│               │ fetch/WS            │       │
└───────────────┼─────────────────────┼───────┘
                │                     │
┌───────────────┼─────────────────────┼───────┐
│         CoreDeno (Deno sidecar)     │       │
│  ┌────────────┴──────────┐    ┌─────┴─────┐ │
│  │  Module Loader        │    │ WC        │ │
│  │  + Permission Gates   │    │ Codegen   │ │
│  │  + Dev Server (HMR)   │    │           │ │
│  └────────────┬──────────┘    └───────────┘ │
│               │ gRPC / Unix socket          │
└───────────────┼─────────────────────────────┘
                │
┌───────────────┼─────────────────────────────┐
│         CoreGO (host process)               │
│  ┌────────┐ ┌┴───────┐ ┌─────────────────┐ │
│  │ Module │ │ gRPC   │ │ MCPBridge       │ │
│  │Registry│ │ Server │ │ (WebView tools) │ │
│  └────────┘ └────────┘ └─────────────────┘ │
└─────────────────────────────────────────────┘
```

### 2.2 Lifecycle

Go spawns Deno as a managed child process at app startup:
- Auto-restart on crash
- SIGTERM on app shutdown
- Health monitoring via gRPC ping

### 2.3 Communication

- **Channel:** Unix domain socket at `$XDG_RUNTIME_DIR/core/deno.sock`
- **Protocol:** gRPC (proto definitions shared between Go and TS)
- **Direction:** Bidirectional
  - Deno → Go: I/O requests gated by permissions
  - Go → Deno: Module lifecycle events, re-render triggers

---

## 3. Three Roles

### 3.1 Module Loader + Sandbox

Reads `.core/view.yaml` manifests, loads modules with per-module permission flags:

```yaml
# .core/view.yaml
permissions:
  read: ["./photos/"]
  net: []
  run: []
```

CoreDeno translates to Deno flags:
```bash
deno run --allow-read=./photos/ --deny-net --deny-run module.ts
```

Each module runs in a Deno isolate. Cross-module communication goes through the IPC layer, not direct imports.

### 3.2 I/O Fortress Gateway

All file/network/process I/O from modules routes through Deno's permission gates before reaching Go via gRPC:

```
Module requests fs.read("/etc/passwd")
  → Deno permission check: "/etc/passwd" not in allowed paths
  → DENIED — Go never sees the request
```

This is the same SASE containment model as go-io's sandbox — the CWD at launch becomes the immutable root boundary.

### 3.3 Build/Dev Toolchain

- **TypeScript compilation** — native in Deno, no build step
- **Module resolution** — import maps, URL imports
- **Dev server** — HMR (Hot Module Replacement) for live development
- **Asset serving** — serves compiled bundles in production
- **Replaces** Node/npm entirely

---

## 4. Browser Runtime

### 4.1 Web Components

CoreTS provides the client-side Web Component registration and lifecycle:

```typescript
// Auto-generated from .core/view.yaml by go-html codegen
class PhotoGrid extends HTMLElement {
  #shadow: ShadowRoot;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: 'closed' });
  }

  connectedCallback() {
    // Fetch data via CoreGO gRPC bridge
    // Render into shadow DOM
  }
}

customElements.define('photo-grid', PhotoGrid);
```

### 4.2 WASM Interop

go-html compiles to WASM for client-side rendering. CoreTS loads and manages the WASM module:

```typescript
// Load go-html WASM
const wasm = await WebAssembly.instantiateStreaming(
  fetch('/gohtml.wasm'),
  importObject
);

// Server pre-renders initial load
// Client handles dynamic re-renders via WASM
```

### 4.3 Wails v3 Bridge

When running inside Wails (desktop/mobile), CoreTS uses the auto-generated bindings:

```typescript
// Auto-generated by Wails in frontend/bindings/
import { ProcessService } from '../bindings';

// Direct Go goroutine call — no HTTP overhead
const result = await ProcessService.Run('git', ['log', '--oneline']);

// Bidirectional events
Events.On('agent.completed', (data) => {
  // React to Go-side events
});
```

### 4.4 `core://` Route Handling

CoreTS intercepts `core://` URLs in the browser runtime. Standard web routes go through HTTP. `core://` routes go through the Wails bridge to Go services — no network round-trip.

```typescript
// CoreTS router intercepts core:// navigation
//
//   router.handle("core://settings", () => bridge.query("gui.route.settings"))
//   router.handle("core://store", () => bridge.query("gui.route.store"))
//   router.handle("core://models", () => bridge.query("gui.route.models"))
class CoreRouter {
  handle(scheme: string, path: string): Promise<RouteResult> {
    if (scheme === 'core') {
      return this.bridge.dispatch(path);
    }
    return this.httpNavigate(path);
  }
}
```

See `code/core/gui/RFC.md §12.1` for the full route table and display service integration.

When a Web Component or Angular route links to `core://agent`, CoreTS:

1. Intercepts the navigation event
2. Strips the `core://` prefix
3. Calls the Wails bridge with the path as an IPC query
4. Renders the returned data into the current view or opens a new window

This enables PWAs to link to native app surfaces without knowing they're running inside CoreGUI.

---

## 5. Browser Storage API Polyfill

WebView normally caches to OS browser cache. CoreTS polyfills ALL browser storage APIs to route through go-store (`code/core/go/store/RFC.md`), giving PWAs native-quality storage backed by encrypted, persistent, origin-scoped data.

### 5.1 localStorage

```typescript
// CoreTS localStorage replacement — persistent KV, no expiry
//
//   window.localStorage.setItem("theme", "dark")
//   → go-store KV set (scoped to origin)
class CoreLocalStorage implements Storage {
  async getItem(key: string): Promise<string | null> {
    return await rpc.store.get(this.namespace, key);
  }

  async setItem(key: string, value: string): Promise<void> {
    await rpc.store.set(this.namespace, key, value);
  }
}

// Saves to ~/.core/data/objects/{namespace}/ (encrypted)
// Not OS browser cache
```

Each app/module gets its own namespace. Data is isolated and encrypted.

### 5.2 sessionStorage

```typescript
// CoreTS sessionStorage — KV with TTL = session lifetime
//
//   window.sessionStorage.setItem("wizard_step", "3")
//   → go-store KV set with TTL (cleared on window close)
class CoreSessionStorage implements Storage {
  constructor(private sessionId: string) {}

  async setItem(key: string, value: string): Promise<void> {
    await rpc.store.set(this.namespace, key, value, { ttl: 'session', sessionId: this.sessionId });
  }
}
```

Session lifetime is tied to the CoreGUI window lifecycle. When the window closes, the display service emits a lifecycle event and go-store expires the session namespace.

### 5.3 IndexedDB

```typescript
// CoreTS IndexedDB polyfill — structured data backed by DuckDB
//
//   const db = await indexedDB.open("myapp", 1)
//   → go-store DuckDB database (scoped to origin)
class CoreIndexedDB implements IDBFactory {
  open(name: string, version?: number): IDBOpenDBRequest {
    // Proxies to go-store DuckDB via Wails bridge
    // Object stores → DuckDB tables
    // Indexes → DuckDB indexes
    // Transactions → DuckDB transactions
    return new CoreIDBOpenDBRequest(this.bridge, this.origin, name, version);
  }
}
```

DuckDB provides the full IndexedDB transaction model — object stores map to tables, indexes map to DuckDB indexes, cursors map to DuckDB queries with pagination.

### 5.4 Cookies

```typescript
// CoreTS cookie polyfill — go-store KV with expiry/path/domain
//
//   document.cookie = "session_id=abc123; expires=Thu, 01 Jan 2099; path=/; Secure"
//   → go-store KV set with expiry metadata
Object.defineProperty(document, 'cookie', {
  get: () => coreCookieJar.serialize(),
  set: (value: string) => coreCookieJar.parse(value),
});
```

The cookie jar respects expiry, path, domain, secure, and HttpOnly flags. HttpOnly cookies are visible to Go services but not to JavaScript — enforced at the polyfill layer.

### 5.5 Cache Storage

```typescript
// CoreTS Cache Storage — request/response pairs for service worker caches
//
//   const cache = await caches.open("v1")
//   await cache.put(request, response)
//   → go-store KV (headers/metadata) + filesystem (body)
class CoreCacheStorage implements CacheStorage {
  async open(cacheName: string): Promise<Cache> {
    return new CoreCache(this.bridge, this.origin, cacheName);
  }
}
```

Cache bodies are stored on the filesystem via go-store. Metadata (headers, URL, method) is stored in KV. This enables offline PWA support without relying on browser cache eviction policies.

### 5.6 Storage Buckets

```typescript
// CoreTS Storage Buckets — quota-managed scoped storage
//
//   const bucket = await navigator.storageBuckets.open("photos", { quota: 50_000_000 })
//   → go-store ScopedStore with per-bucket quota
class CoreStorageBucketManager implements StorageBucketManager {
  async open(name: string, options?: StorageBucketOptions): Promise<StorageBucket> {
    return new CoreStorageBucket(this.bridge, this.origin, name, options);
  }
}
```

Each bucket maps to a go-store `ScopedStore` with its own quota limit and persistence policy.

### 5.7 Origin Private File System (OPFS)

```typescript
// CoreTS OPFS — isolated directory per origin, child-only access
//
//   const root = await navigator.storage.getDirectory()
//   const file = await root.getFileHandle("data.bin", { create: true })
//   → go-store isolated directory, no parent traversal
class CoreOPFS implements FileSystemDirectoryHandle {
  constructor(private bridge: WailsBridge, private origin: string) {}

  async getFileHandle(name: string, opts?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    // Resolves within go-store's origin-scoped directory
    // Parent traversal ("../") is rejected at the go-store level
    return new CoreFileHandle(this.bridge, this.origin, name, opts);
  }
}
```

OPFS provides a sandboxed filesystem where each origin can only access its own directory tree. go-store enforces child-only access — no path traversal beyond the origin root.

### 5.8 Polyfill Injection

All polyfills are injected into the WebView before any page JavaScript executes:

```typescript
// storage.ts — injected at page load by display service
//
//   CoreGUI display.InjectPolyfills(webview, origin)
//   → replaces window.localStorage, sessionStorage, indexedDB,
//     document.cookie, caches, navigator.storageBuckets, navigator.storage
export function injectStoragePolyfills(origin: string, bridge: WailsBridge): void {
  Object.defineProperty(window, 'localStorage', { get: () => new CoreLocalStorage(origin, bridge) });
  Object.defineProperty(window, 'sessionStorage', { get: () => new CoreSessionStorage(origin, bridge) });
  Object.defineProperty(window, 'indexedDB', { get: () => new CoreIndexedDB(origin, bridge) });
  Object.defineProperty(window, 'caches', { get: () => new CoreCacheStorage(origin, bridge) });
  // ... Storage Buckets, OPFS via navigator.storage/navigator.storageBuckets
}
```

---

## 6. PGP Key Dance (Zero-Trust Local Auth)

From the dAppServer prototype — secure local communication without TLS:

```
1. CoreGO starts, generates PGP keypair
2. Key password = lthn_hash(CWD) — only the local binary knows this
3. CoreDeno receives public key via gRPC
4. All subsequent messages encrypted with PGP
5. No certificates needed — PGP provides authentication
```

This enables secure communication on localhost without the overhead of TLS certificate management.

---

## 7. SDK Generation Target

CoreTS is a first-class target for SDK generation (see build RFC):

```
CoreCommand tree (Go)
  → OpenAPI spec
    → openapi-typescript-codegen
      → typed TypeScript client
```

Developers write one Go function. The TypeScript SDK is generated automatically. In desktop mode (Wails), the SDK calls Go goroutines directly — no HTTP.

---

## 8. Angular Migration Path

### Phase 4a (Current)
Web Components load inside Angular. Angular sees custom elements via `CUSTOM_ELEMENTS_SCHEMA`. No Angular code needed for new modules.

### Phase 4b
ApplicationFrame becomes a go-html Web Component. Angular router replaced by lightweight hash-based router (~50 lines).

### Phase 4c (Target)
Angular removed entirely. WebView2 loads:
1. go-html WASM (layout engine + WC factory)
2. CoreTS thin router
3. CoreDeno-served module bundles
4. Web Awesome (design system — vanilla custom elements)

### Post-Angular Stack
```
WebView2
  └── CoreTS app shell (~200 lines)
        ├── Router (hash-based, ~50 lines)
        ├── go-html WASM (layout + WC registration)
        ├── Web Awesome (design system)
        └── Module bundles (from CoreDeno)
```

---

## 9. i18n Integration

CoreTS implements the same i18n API as CoreGO and CorePHP (see `code/core/i18n/RFC.md`):

```typescript
// Same stable API across all languages
import { _, T, S } from '@core/i18n';

_('cli.success');                              // Simple lookup
T('core.delete', S('file', path));             // Semantic intent
T('core.save', S('changes', 3).Count(3));      // With plurality
```

Same JSON format, same intent system. Translations shared across Go/TS/PHP.

---

## 10. Package Structure

```
core-deno/                    # Sidecar runtime (new repo)
  src/
    mod.ts                    # Entry point
    sidecar.ts                # gRPC client, lifecycle management
    loader.ts                 # Module loader + permission mapping
    ipc.ts                    # IPC bridge to CoreGO
    storage.ts                # Browser storage API polyfills (localStorage, sessionStorage, IndexedDB, cookies, Cache Storage, Storage Buckets, OPFS)
    electron.ts               # Electron compatibility shim (window.electron, require('electron'), fs proxy)
    router.ts                 # Hash-based router with core:// scheme handling (~50 lines)
    auth.ts                   # PGP key dance
    dev.ts                    # Dev server + HMR
  proto/
    core.proto                # Shared gRPC definitions
  deps.ts                     # Deno import map

core/ts/                      # Framework library
  src/
    i18n.ts                   # i18n API (_/T/S)
    components.ts             # Web Component base classes
    wasm.ts                   # go-html WASM loader
    events.ts                 # Event bus (matches CoreGO IPC)
    result.ts                 # Result type (matches CoreGO)
    options.ts                # Options type (matches CoreGO)
```

---

## 11. Distribution

| Target | How |
|--------|-----|
| Desktop (macOS/Windows/Linux) | Wails v3 binary bundles CoreDeno |
| iOS | Wails v3 alpha 74 (iOS target) |
| Android | Wails v3 alpha 74 (Android target) |
| Web (PWA) | CoreDeno serves bundles, service worker for offline |
| CLI | `deno run` standalone |
| Edge | Deno Deploy or self-hosted |

---

## 12. Implementation Priority

| Feature | Description |
|---------|-------------|
| gRPC proto definitions | Shared protocol definitions between Go and TypeScript |
| CoreDeno sidecar manager | Go-side process management: spawn, restart, shutdown |
| Deno gRPC client | TypeScript client connecting to CoreGO host process |
| Module loader with Deno permission mapping | Load modules with per-module permission flags from .core/view.yaml |
| Dev server with HMR | Hot Module Replacement for live development |
| Web Component base classes | Client-side Web Component registration and lifecycle |
| go-html WASM loader | Load and manage go-html WASM module for client-side rendering |
| localStorage polyfill | Route storage through encrypted object store instead of browser cache |
| sessionStorage polyfill | Session-scoped KV with TTL tied to window lifecycle |
| IndexedDB polyfill | Structured data via go-store DuckDB (object stores, indexes, transactions) |
| Cookie polyfill | go-store KV with expiry, path, domain, secure, HttpOnly flags |
| Cache Storage polyfill | Request/response pairs for service worker offline caches |
| Storage Buckets polyfill | Quota-managed ScopedStore per bucket |
| OPFS polyfill | Origin-scoped isolated directory with child-only access enforcement |
| Polyfill injection pipeline | Inject all storage shims before page JavaScript executes |
| `core://` route handler | Intercept core:// URLs, route through Wails bridge to Go services |
| Hash-based router | Lightweight routing replacing Angular router, with core:// scheme support |
| Event bus | Mirror CoreGO IPC events in the browser |
| PGP key dance | Zero-trust local auth between CoreGO and CoreDeno |
| I/O fortress enforcement tests | Verify Deno permission gates block unauthorised access |
| Module isolation verification | Confirm cross-module communication only through IPC |
| TypeScript SDK generation from OpenAPI | Auto-generate typed client from CoreCommand tree |
| i18n implementation | _/T/S API matching CoreGO and CorePHP |
| Shared JSON locale loading | Load same translation files across all language implementations |
| Electron shim preload injection | Create `window.electron` object before page JS executes |
| Electron ipcRenderer mapping | Route send/invoke/on through Core IPC actions and queries |
| Electron shell/clipboard/dialog mapping | Route Electron UI APIs through CoreGUI packages |
| Electron notification shim | Map Electron Notification class to `gui.notification.send` |
| Node.js require() shim | Intercept `require('electron')` and `require('fs')` patterns |
| Electron fs proxy via go-io | Sandboxed filesystem proxy for Electron apps using `require('fs')` |
| Electron validation: Hyper | Validate shim with Hyper terminal (simplest Electron surface) |
| Hyperswarm integration | P2P peer discovery for LetherNet Layer 5 |
| CryptoNote+ shared secret | WASM bridge to Go crypto for encrypted P2P |
| Peer discovery and messaging | Find and communicate with network peers |
| NAT traversal | Punch through NATs for direct peer connections |

---

## 13. Electron Compatibility Layer

CoreGUI controls the WebView2/WebKit global scope. CoreTS injects a preload script that runs before any page JavaScript in the V8 (Windows/Linux) or JSC (macOS/iOS) engine. By creating a `window.electron` shim that routes Electron API calls through CoreTS → Wails bridge → Go services, existing Electron apps run inside CoreGUI unchanged.

### 13.1 Preload Injection

The preload script executes before any page JavaScript. CoreGUI's display service injects it at page load — the same mechanism used for storage polyfills (§5.8):

```typescript
// electron-shim.ts — injected by CoreGUI display.InjectPreload(webview)
// Runs before ANY page JavaScript in V8/JSC
//
//   // Existing Electron app code works unchanged:
//   const { ipcRenderer } = require('electron');
//   ipcRenderer.send('app:ready', { version: '1.0' });
//   // → routes through window.core.ipc.action('app:ready', { version: '1.0' })
export function injectElectronShim(bridge: WailsBridge): void {
  const shim = buildElectronShim(bridge);
  Object.defineProperty(window, 'electron', { get: () => shim, configurable: false });
  // Node.js require() shim for common patterns
  Object.defineProperty(window, 'require', {
    get: () => (module: string) => {
      if (module === 'electron') return shim;
      throw new Error(`require('${module}') is not supported — use Core imports`);
    },
    configurable: false,
  });
}
```

### 13.2 Shim Mapping

Every Electron API call maps to an existing Core primitive. CoreGUI already has 1:1 equivalents for every Electron surface — the shim is a thin routing layer, not a reimplementation.

| Electron API | Core Primitive | CoreGUI Package |
|-------------|---------------|-----------------|
| `window.electron.ipcRenderer.send(channel, data)` | `core.ipc.action(channel, data)` | `go/ipc` |
| `window.electron.ipcRenderer.invoke(channel, data)` | `core.ipc.query(channel, data)` | `go/ipc` |
| `window.electron.ipcRenderer.on(channel, handler)` | `core.ipc.on(channel, handler)` | `go/ipc` |
| `window.electron.shell.openExternal(url)` | `core.browser.open(url)` | `gui/browser` |
| `window.electron.shell.openPath(path)` | `core.browser.openFile(path)` | `gui/browser` |
| `window.electron.clipboard.readText()` | `core.clipboard.read()` | `gui/clipboard` |
| `window.electron.clipboard.writeText(text)` | `core.clipboard.write(text)` | `gui/clipboard` |
| `window.electron.dialog.showOpenDialog(opts)` | `core.dialog.open(opts)` | `gui/dialog` |
| `window.electron.dialog.showSaveDialog(opts)` | `core.dialog.save(opts)` | `gui/dialog` |
| `window.electron.dialog.showMessageBox(opts)` | `core.dialog.message(opts)` | `gui/dialog` |
| `window.electron.notification(opts)` | `core.notification.send(opts)` | `gui/notification` |
| `window.require('electron')` | `window.electron` | (shim) |

### 13.3 Implementation

```typescript
// buildElectronShim — creates the window.electron object
//
//   const shim = buildElectronShim(bridge);
//   shim.ipcRenderer.send('channel', data);  → bridge.action('channel', data)
//   shim.clipboard.readText();               → bridge.query('gui.clipboard.read')
function buildElectronShim(bridge: WailsBridge): ElectronShim {
  return {
    ipcRenderer: {
      send: (channel: string, ...args: unknown[]) =>
        bridge.action(channel, ...args),
      invoke: (channel: string, ...args: unknown[]) =>
        bridge.query(channel, ...args),
      on: (channel: string, handler: (...args: unknown[]) => void) =>
        bridge.on(channel, handler),
      once: (channel: string, handler: (...args: unknown[]) => void) =>
        bridge.once(channel, handler),
      removeListener: (channel: string, handler: (...args: unknown[]) => void) =>
        bridge.off(channel, handler),
      removeAllListeners: (channel?: string) =>
        bridge.offAll(channel),
    },
    shell: {
      openExternal: (url: string) =>
        bridge.action('gui.browser.open', { url }),
      openPath: (path: string) =>
        bridge.action('gui.browser.openFile', { path }),
    },
    clipboard: {
      readText: () => bridge.query('gui.clipboard.read'),
      writeText: (text: string) => bridge.action('gui.clipboard.write', { text }),
    },
    dialog: {
      showOpenDialog: (opts: OpenDialogOptions) =>
        bridge.query('gui.dialog.open', opts),
      showSaveDialog: (opts: SaveDialogOptions) =>
        bridge.query('gui.dialog.save', opts),
      showMessageBox: (opts: MessageBoxOptions) =>
        bridge.query('gui.dialog.message', opts),
    },
    Notification: class CoreNotification {
      constructor(private opts: NotificationOptions) {}
      show() { bridge.action('gui.notification.send', this.opts); }
    },
  };
}
```

### 13.4 Node.js `require()` Shim

Electron apps use `require('electron')` to access the Electron API. The shim intercepts this single pattern and returns the `window.electron` object. All other `require()` calls are rejected — Node.js module loading is not supported. Electron apps that import Node.js built-in modules (`fs`, `path`, `crypto`, `net`) are handled by routing through Core equivalents:

```typescript
// require() shim — handles common Node.js patterns
//
//   const { ipcRenderer } = require('electron');   → window.electron.ipcRenderer
//   const fs = require('fs');                       → CoreFS proxy (go-io sandbox)
//   const path = require('path');                   → CorePath proxy (pure functions)
//   const crypto = require('crypto');               → rejected (use Core crypto)
const requireShim = (module: string): unknown => {
  switch (module) {
    case 'electron': return window.electron;
    case 'fs': return coreFsProxy;         // go-io sandboxed filesystem
    case 'path': return corePathProxy;     // pure path functions (no I/O)
    default: throw new Error(
      `require('${module}') is not available. Use Core imports instead.`
    );
  }
};
```

The `fs` proxy routes all filesystem operations through go-io's sandbox (SASE containment). No direct filesystem access — reads and writes are gated by the app's `.core/view.yaml` permissions.

### 13.5 Validation Targets

| App | Difficulty | Surface | Why |
|-----|-----------|---------|-----|
| Hyper | Easy | ipcRenderer, shell.openExternal, clipboard | Simplest real Electron app — terminal with minimal API surface |
| Signal Desktop | Medium | ipcRenderer, notification, clipboard, dialog | Messaging app — heavier IPC, notifications, file dialogs |
| Obsidian | Medium | ipcRenderer, shell, clipboard, dialog, fs shim | Note-taking — filesystem-heavy, uses `fs` for vault access |
| VS Code (web) | Hard | Full surface + extensions API | Already has web version — validates completeness |

### 13.6 Limitations

- **No Node.js filesystem access** — Electron apps using `require('fs')` get the go-io sandbox proxy. Direct filesystem calls are gated by manifest permissions. Apps expecting unrestricted filesystem access need their permissions declared in `.core/view.yaml`.
- **No native modules** — Electron apps using native Node.js addons (`.node` files) cannot run. The equivalent functionality is provided by Go packages exposed through the Wails bridge.
- **No Electron main process** — only renderer process code runs. Main process logic (window creation, menu setup, app lifecycle) is handled by CoreGUI's existing services.
- **No `remote` module** — deprecated in Electron and not shimmed. Apps must use `ipcRenderer` patterns.
- **No `webContents` API** — CoreGUI's webview package provides equivalent automation capabilities through `gui.webview.*` actions.

---

## 14. Reference Material

CoreTS operates at Layer 5 (Applications) of the network protocol. See `code/core/network/RFC.md` §2 for layer definitions. P2P transport (L2) is handled by `code/core/go/p2p`.

| Resource | Location |
|----------|----------|
| CoreApp spec (dAppServer heritage) | `code/core/app/RFC.md` |
| dAppServer repos | `github.com/dAppServer/` (20 repos) |
| core-element-template | `github.com/Snider/core-element-template` |
| HTML RFC | `code/core/go/html/RFC.md` |
| Cross-language i18n | `code/core/i18n/RFC.md` |
| Phase 4 design | `go-html/docs/plans/2026-02-17-phase4-coredeno-webcomponents-design.md` |
| Future improvements | Session notes from 2026-02-02 lab setup |

---

## Changelog

- 2026-04-08: §13 — Electron Compatibility Layer. Preload injection creates `window.electron` shim routing Electron API calls through CoreTS → Wails bridge → Go. Full mapping table (ipcRenderer, shell, clipboard, dialog, notification, require). Node.js `require()` shim for `electron` and `fs` modules. Validation targets: Hyper (easy), Signal (medium), Obsidian (medium), VS Code web (hard). Limitations documented: no native modules, no main process, renderer-only
- 2026-04-08: §4.4 — `core://` route handling in browser runtime. §5 expanded from localStorage-only to full browser storage API polyfill surface (7 APIs: localStorage, sessionStorage, IndexedDB, cookies, Cache Storage, Storage Buckets, OPFS — all backed by go-store)
- 2026-03-27: Initial RFC assembled from dAppServer heritage, Phase 4 design docs, core-framework polyglot architecture, and future improvements session notes.
