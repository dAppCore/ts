export interface CoreStoreSetOptions {
  ttl?: "session";
  sessionId?: string;
}

export interface CoreStoreBridge {
  get(namespace: string, key: string): Promise<string | null>;
  set(
    namespace: string,
    key: string,
    value: string,
    options?: CoreStoreSetOptions,
  ): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string): Promise<string[]>;
  clear(namespace: string): Promise<void>;
}

export interface CoreIndexedDBBridge {
  open(origin: string, name: string, version?: number): Promise<unknown>;
  deleteDatabase(origin: string, name: string): Promise<void>;
  databases?(origin: string): Promise<string[]>;
}

export interface CoreCookieRecord {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface CoreCookieBridge {
  list(origin: string): Promise<CoreCookieRecord[]>;
  set(origin: string, cookie: CoreCookieRecord): Promise<void>;
  delete(
    origin: string,
    name: string,
    options?: Pick<CoreCookieRecord, "path" | "domain">,
  ): Promise<void>;
}

export interface CoreCacheRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

export interface CoreCacheResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface CoreCacheBridge {
  open(origin: string, cacheName: string): Promise<void>;
  put(
    origin: string,
    cacheName: string,
    request: CoreCacheRequest,
    response: CoreCacheResponse,
  ): Promise<void>;
  match(
    origin: string,
    cacheName: string,
    request: CoreCacheRequest,
  ): Promise<CoreCacheResponse | null>;
  delete(
    origin: string,
    cacheName: string,
    request: CoreCacheRequest,
  ): Promise<boolean>;
  keys(origin: string, cacheName: string): Promise<CoreCacheRequest[]>;
}

export interface StorageBucketOptions {
  quota?: number;
  persisted?: boolean;
}

export interface FileSystemGetDirectoryOptions {
  create?: boolean;
}

export interface FileSystemGetFileOptions {
  create?: boolean;
}

export interface CoreBucketBridge {
  open(
    origin: string,
    name: string,
    options?: StorageBucketOptions,
  ): Promise<void>;
  delete(origin: string, name: string): Promise<void>;
  keys?(origin: string): Promise<string[]>;
}

export interface CoreFileBridge {
  read(origin: string, path: string): Promise<string | null>;
  write(origin: string, path: string, data: string): Promise<void>;
  delete(origin: string, path: string): Promise<void>;
  list(origin: string, path: string): Promise<string[]>;
  mkdir(origin: string, path: string): Promise<void>;
}

export interface CoreStorageBridge {
  store: CoreStoreBridge;
  indexedDB?: CoreIndexedDBBridge;
  cookies?: CoreCookieBridge;
  cache?: CoreCacheBridge;
  buckets?: CoreBucketBridge;
  fs?: CoreFileBridge;
}

export interface CoreStoragePolyfillTarget {
  localStorage?: unknown;
  sessionStorage?: unknown;
  indexedDB?: unknown;
  caches?: unknown;
  navigator?: Record<string, unknown>;
  document?: Record<string, unknown>;
}

export interface InjectStoragePolyfillsOptions {
  sessionId?: string;
  target?: CoreStoragePolyfillTarget;
}

export interface CoreStoragePolyfills {
  localStorage: CoreLocalStorage;
  sessionStorage: CoreSessionStorage;
  indexedDB: CoreIndexedDB;
  cookies: CoreCookieJar;
  caches: CoreCacheStorage;
  storageBuckets: CoreStorageBucketManager;
  storage: CoreNavigatorStorage;
}

interface BrowserStorageFacade {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export interface CoreIndexedDBDatabase {
  origin: string;
  name: string;
  version?: number;
  raw: unknown;
}

export interface CoreIndexedDBRequestEvent<T> {
  readonly type: "success" | "error";
  readonly target: CoreIndexedDBRequest<T>;
}

export type CoreIndexedDBRequestHandler<T> = (
  event: CoreIndexedDBRequestEvent<T>,
) => void | Promise<void>;

export class CoreIndexedDBRequest<T> implements PromiseLike<T> {
  readyState: "pending" | "done" = "pending";
  result: T | null = null;
  error: unknown = null;
  onsuccess: CoreIndexedDBRequestHandler<T> | null = null;
  onerror: CoreIndexedDBRequestHandler<T> | null = null;

  private readonly listeners = new Map<
    "success" | "error",
    Set<CoreIndexedDBRequestHandler<T>>
  >();
  private readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;
  private rejectPromise!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    void this.promise.catch(() => undefined);
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.promise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.promise.finally(onfinally ?? undefined);
  }

  addEventListener(
    type: "success" | "error",
    handler: CoreIndexedDBRequestHandler<T>,
  ): void {
    this.bucket(type).add(handler);
  }

  removeEventListener(
    type: "success" | "error",
    handler: CoreIndexedDBRequestHandler<T>,
  ): void {
    this.listeners.get(type)?.delete(handler);
  }

  resolve(value: T): void {
    if (this.readyState === "done") {
      return;
    }
    this.readyState = "done";
    this.result = value;
    const event = this.createEvent("success");
    void this.onsuccess?.(event);
    void this.emit("success", event).catch(() => undefined);
    this.resolvePromise(value);
  }

  reject(error: unknown): void {
    if (this.readyState === "done") {
      return;
    }
    this.readyState = "done";
    this.error = error;
    const event = this.createEvent("error");
    void this.onerror?.(event);
    void this.emit("error", event).catch(() => undefined);
    this.rejectPromise(error);
  }

  private bucket(type: "success" | "error"): Set<CoreIndexedDBRequestHandler<T>> {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    return set;
  }

  private createEvent(type: "success" | "error"): CoreIndexedDBRequestEvent<T> {
    return {
      type,
      target: this,
    };
  }

  private async emit(
    type: "success" | "error",
    event: CoreIndexedDBRequestEvent<T>,
  ): Promise<void> {
    const set = this.listeners.get(type);
    if (!set) {
      return;
    }
    for (const handler of Array.from(set)) {
      await handler(event);
    }
  }
}

const namespacePrefix = "corets";

export class CoreLocalStorage {
  constructor(
    protected readonly origin: string,
    protected readonly bridge: CoreStorageBridge,
    protected readonly namespace = storageNamespace(origin, "local"),
  ) {}

  async length(): Promise<number> {
    return (await this.bridge.store.list(this.namespace)).length;
  }

  async key(index: number): Promise<string | null> {
    const keys = await this.bridge.store.list(this.namespace);
    return keys[index] ?? null;
  }

  async getItem(key: string): Promise<string | null> {
    return this.bridge.store.get(this.namespace, key);
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.bridge.store.set(this.namespace, key, value);
  }

  async removeItem(key: string): Promise<void> {
    await this.bridge.store.delete(this.namespace, key);
  }

  async clear(): Promise<void> {
    await this.bridge.store.clear(this.namespace);
  }
}

function createStorageFacade(storage: CoreLocalStorage): BrowserStorageFacade {
  type StorageSource = CoreLocalStorage & {
    bridge: CoreStorageBridge;
    namespace: string;
  };

  const source = storage as unknown as StorageSource;
  const cache = new Map<string, string>();
  let hydrated = false;
  let hydration: Promise<void> | null = null;

  const hydrate = (): Promise<void> => {
    if (hydration) {
      return hydration;
    }

    hydration = (async () => {
      const keys = await source.bridge.store.list(source.namespace);
      cache.clear();
      for (const key of keys) {
        const value = await source.bridge.store.get(source.namespace, key);
        if (value !== null) {
          cache.set(key, value);
        }
      }
      hydrated = true;
    })();

    return hydration;
  };

  void hydrate();

  return {
    get length(): number {
      return cache.size;
    },
    key(index: number): string | null {
      return Array.from(cache.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      if (!hydrated && cache.size === 0) {
        void hydrate();
      }
      return cache.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      cache.set(key, value);
      void source.bridge.store.set(source.namespace, key, value).catch(() => {
        // Keep the optimistic in-memory view available even if the bridge fails.
      });
    },
    removeItem(key: string): void {
      cache.delete(key);
      void source.bridge.store.delete(source.namespace, key).catch(() => {
        // Keep the optimistic in-memory view available even if the bridge fails.
      });
    },
    clear(): void {
      cache.clear();
      void source.bridge.store.clear(source.namespace).catch(() => {
        // Keep the optimistic in-memory view available even if the bridge fails.
      });
    },
  };
}

export class CoreSessionStorage extends CoreLocalStorage {
  constructor(
    origin: string,
    bridge: CoreStorageBridge,
    private readonly sessionId: string,
  ) {
    super(origin, bridge, storageNamespace(origin, "session"));
  }

  override async setItem(key: string, value: string): Promise<void> {
    await this.bridge.store.set(this.namespace, key, value, {
      ttl: "session",
      sessionId: this.sessionId,
    });
  }
}

export class CoreIndexedDB {
  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
  ) {}

  open(name: string, version?: number): CoreIndexedDBRequest<CoreIndexedDBDatabase> {
    const request = new CoreIndexedDBRequest<CoreIndexedDBDatabase>();
    const indexedDB = this.requireBridge("indexedDB", this.bridge.indexedDB);
    void (async () => {
      try {
        const raw = await indexedDB.open(this.origin, name, version);
        request.resolve({ origin: this.origin, name, version, raw });
      } catch (error) {
        request.reject(error);
      }
    })();
    return request;
  }

  async deleteDatabase(name: string): Promise<void> {
    const indexedDB = this.requireBridge("indexedDB", this.bridge.indexedDB);
    await indexedDB.deleteDatabase(this.origin, name);
  }

  async databases(): Promise<string[]> {
    const indexedDB = this.requireBridge("indexedDB", this.bridge.indexedDB);
    if (!indexedDB.databases) {
      return [];
    }
    return indexedDB.databases(this.origin);
  }

  private requireBridge<T>(name: string, value: T | undefined): T {
    if (!value) {
      throw new Error(`${name} bridge is not configured`);
    }
    return value;
  }
}

export class CoreCookieJar {
  private snapshotValue = "";
  private cachedCookies: CoreCookieRecord[] = [];
  private currentPath = "/";
  private secureContext = false;

  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
  ) {}

  snapshot(): string {
    return this.snapshotValue;
  }

  async refresh(currentPath = "/", secure = false): Promise<string> {
    this.currentPath = currentPath;
    this.secureContext = secure;
    this.cachedCookies = await this.requireBridge().list(this.origin);
    this.snapshotValue = serialiseCookies(
      this.cachedCookies,
      this.origin,
      currentPath,
      secure,
    );
    return this.snapshotValue;
  }

  async set(serialized: string): Promise<void> {
    const record = parseCookie(serialized, this.origin);
    this.cachedCookies = upsertCookie(this.cachedCookies, record);
    this.snapshotValue = serialiseCookies(
      this.cachedCookies,
      this.origin,
      this.currentPath,
      this.secureContext,
    );
    await this.requireBridge().set(this.origin, record);
    await this.refresh(this.currentPath, this.secureContext);
  }

  async delete(
    name: string,
    options?: Pick<CoreCookieRecord, "path" | "domain">,
  ): Promise<void> {
    this.cachedCookies = removeCookie(this.cachedCookies, name, options);
    this.snapshotValue = serialiseCookies(
      this.cachedCookies,
      this.origin,
      this.currentPath,
      this.secureContext,
    );
    await this.requireBridge().delete(this.origin, name, options);
    await this.refresh(this.currentPath, this.secureContext);
  }

  private requireBridge(): CoreCookieBridge {
    if (!this.bridge.cookies) {
      throw new Error("cookies bridge is not configured");
    }
    return this.bridge.cookies;
  }
}

export class CoreCache {
  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
    readonly name: string,
  ) {}

  async put(
    request: string | URL | CoreCacheRequest,
    response: CoreCacheResponse,
  ): Promise<void> {
    await this.requireBridge().put(
      this.origin,
      this.name,
      normaliseRequest(request),
      response,
    );
  }

  async match(
    request: string | URL | CoreCacheRequest,
  ): Promise<CoreCacheResponse | null> {
    return this.requireBridge().match(
      this.origin,
      this.name,
      normaliseRequest(request),
    );
  }

  async delete(request: string | URL | CoreCacheRequest): Promise<boolean> {
    return this.requireBridge().delete(
      this.origin,
      this.name,
      normaliseRequest(request),
    );
  }

  async keys(): Promise<CoreCacheRequest[]> {
    return this.requireBridge().keys(this.origin, this.name);
  }

  private requireBridge(): CoreCacheBridge {
    if (!this.bridge.cache) {
      throw new Error("cache bridge is not configured");
    }
    return this.bridge.cache;
  }
}

export class CoreCacheStorage {
  private readonly caches = new Map<string, CoreCache>();

  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
  ) {}

  async open(cacheName: string): Promise<CoreCache> {
    let cache = this.caches.get(cacheName);
    if (!cache) {
      const bridge = this.requireBridge();
      await bridge.open(this.origin, cacheName);
      cache = new CoreCache(this.origin, this.bridge, cacheName);
      this.caches.set(cacheName, cache);
    }
    return cache;
  }

  async match(
    request: string | URL | CoreCacheRequest,
  ): Promise<CoreCacheResponse | null> {
    for (const cache of this.caches.values()) {
      const response = await cache.match(request);
      if (response) {
        return response;
      }
    }
    return null;
  }

  async delete(cacheName: string): Promise<boolean> {
    const cache = this.caches.get(cacheName);
    if (!cache) {
      return false;
    }

    const requests = await cache.keys();
    for (const request of requests) {
      await cache.delete(request);
    }

    this.caches.delete(cacheName);
    return true;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  private requireBridge(): CoreCacheBridge {
    if (!this.bridge.cache) {
      throw new Error("cache bridge is not configured");
    }
    return this.bridge.cache;
  }
}

export class CoreStorageBucket {
  constructor(
    readonly origin: string,
    private readonly bridge: CoreStorageBridge,
    readonly name: string,
    readonly options?: StorageBucketOptions,
  ) {}

  async delete(): Promise<void> {
    const buckets = this.requireBridge();
    await buckets.delete(this.origin, this.name);
  }

  private requireBridge(): CoreBucketBridge {
    if (!this.bridge.buckets) {
      throw new Error("storage buckets bridge is not configured");
    }
    return this.bridge.buckets;
  }
}

export class CoreStorageBucketManager {
  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
  ) {}

  async open(
    name: string,
    options?: StorageBucketOptions,
  ): Promise<CoreStorageBucket> {
    const buckets = this.requireBridge();
    await buckets.open(this.origin, name, options);
    return new CoreStorageBucket(this.origin, this.bridge, name, options);
  }

  async keys(): Promise<string[]> {
    const buckets = this.requireBridge();
    if (!buckets.keys) {
      return [];
    }
    return buckets.keys(this.origin);
  }

  async delete(name: string): Promise<void> {
    const buckets = this.requireBridge();
    await buckets.delete(this.origin, name);
  }

  private requireBridge(): CoreBucketBridge {
    if (!this.bridge.buckets) {
      throw new Error("storage buckets bridge is not configured");
    }
    return this.bridge.buckets;
  }
}

export class CoreFileHandle {
  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
    readonly path: string,
  ) {}

  async getFile(): Promise<string | null> {
    return this.requireBridge().read(this.origin, this.path);
  }

  async write(content: string): Promise<void> {
    await this.requireBridge().write(this.origin, this.path, content);
  }

  async remove(): Promise<void> {
    await this.requireBridge().delete(this.origin, this.path);
  }

  private requireBridge(): CoreFileBridge {
    if (!this.bridge.fs) {
      throw new Error("filesystem bridge is not configured");
    }
    return this.bridge.fs;
  }
}

export class CoreOPFS {
  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
    readonly path = "",
  ) {}

  async getDirectoryHandle(
    name: string,
    options: FileSystemGetDirectoryOptions = {},
  ): Promise<CoreOPFS> {
    const nextPath = joinOPFSPath(this.path, name);
    if (options.create ?? false) {
      await this.requireBridge().mkdir(this.origin, nextPath);
    }
    return new CoreOPFS(this.origin, this.bridge, nextPath);
  }

  async getFileHandle(
    name: string,
    _options: FileSystemGetFileOptions = {},
  ): Promise<CoreFileHandle> {
    return new CoreFileHandle(
      this.origin,
      this.bridge,
      joinOPFSPath(this.path, name),
    );
  }

  async removeEntry(name: string): Promise<void> {
    await this.requireBridge().delete(this.origin, joinOPFSPath(this.path, name));
  }

  async entries(): Promise<string[]> {
    return this.requireBridge().list(this.origin, this.path);
  }

  private requireBridge(): CoreFileBridge {
    if (!this.bridge.fs) {
      throw new Error("filesystem bridge is not configured");
    }
    return this.bridge.fs;
  }
}

export class CoreNavigatorStorage {
  private readonly opfs: CoreOPFS;

  constructor(
    origin: string,
    bridge: CoreStorageBridge,
    private readonly buckets: CoreStorageBucketManager,
  ) {
    this.opfs = new CoreOPFS(origin, bridge);
  }

  async getDirectory(): Promise<CoreOPFS> {
    return this.opfs;
  }

  async estimate(): Promise<{ quota?: number; usage?: number }> {
    return {};
  }

  storageBuckets(): CoreStorageBucketManager {
    return this.buckets;
  }
}

export function injectStoragePolyfills(
  origin: string,
  bridge: CoreStorageBridge,
  options: InjectStoragePolyfillsOptions = {},
): CoreStoragePolyfills {
  const target = options.target ?? (globalThis as CoreStoragePolyfillTarget);
  const localStorage = new CoreLocalStorage(origin, bridge);
  const sessionStorage = new CoreSessionStorage(
    origin,
    bridge,
    options.sessionId ?? "default",
  );
  const localStorageFacade = createStorageFacade(localStorage);
  const sessionStorageFacade = createStorageFacade(sessionStorage);
  const indexedDB = new CoreIndexedDB(origin, bridge);
  const cookies = new CoreCookieJar(origin, bridge);
  const caches = new CoreCacheStorage(origin, bridge);
  const storageBuckets = new CoreStorageBucketManager(origin, bridge);
  const storage = new CoreNavigatorStorage(origin, bridge, storageBuckets);

  defineGetter(target, "localStorage", () => localStorageFacade);
  defineGetter(target, "sessionStorage", () => sessionStorageFacade);
  defineGetter(target, "indexedDB", () => indexedDB);
  defineGetter(target, "caches", () => caches);

  const navigatorTarget = target.navigator ?? {};
  target.navigator = navigatorTarget;
  defineGetter(navigatorTarget, "storageBuckets", () => storageBuckets);
  defineGetter(navigatorTarget, "storage", () => storage);

  if (target.document) {
    void cookies.refresh();
    Object.defineProperty(target.document, "cookie", {
      configurable: true,
      enumerable: true,
      get: () => cookies.snapshot(),
      set: (value: string) => {
        void cookies.set(value);
      },
    });
  }

  return {
    localStorage,
    sessionStorage,
    indexedDB,
    cookies,
    caches,
    storageBuckets,
    storage,
  };
}

export function parseCookie(
  serialized: string,
  origin: string,
): CoreCookieRecord {
  const parts = serialized.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("cookie string is empty");
  }

  const [namePart, ...attributes] = parts;
  const separator = namePart.indexOf("=");
  if (separator <= 0) {
    throw new Error("cookie must include a name and value");
  }

  const record: CoreCookieRecord = {
    name: namePart.slice(0, separator),
    value: namePart.slice(separator + 1),
    path: "/",
    domain: new URL(origin, "http://localhost/").hostname,
  };

  for (const attribute of attributes) {
    const [rawKey, ...rawValue] = attribute.split("=");
    const key = rawKey.toLowerCase();
    const value = rawValue.join("=");

    switch (key) {
      case "path":
        record.path = value || "/";
        break;
      case "domain":
        record.domain = value || record.domain;
        break;
      case "expires":
        record.expires = value;
        break;
      case "secure":
        record.secure = true;
        break;
      case "httponly":
        record.httpOnly = true;
        break;
      case "samesite":
        {
          const sameSite = value.toLowerCase();
          if (sameSite === "strict") {
            record.sameSite = "Strict";
          } else if (sameSite === "lax") {
            record.sameSite = "Lax";
          } else if (sameSite === "none") {
            record.sameSite = "None";
          }
        }
        break;
    }
  }

  return record;
}

function serialiseCookies(
  cookies: CoreCookieRecord[],
  origin: string,
  currentPath: string,
  secure: boolean,
): string {
  const now = Date.now();
  const host = new URL(origin, "http://localhost/").hostname;

  return cookies
    .filter((cookie) => !cookie.httpOnly)
    .filter((cookie) => !cookie.secure || secure)
    .filter((cookie) => !cookie.expires || Date.parse(cookie.expires) > now)
    .filter((cookie) => pathMatches(currentPath, cookie.path ?? "/"))
    .filter((cookie) => domainMatches(host, cookie.domain ?? host))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function pathMatches(currentPath: string, cookiePath: string): boolean {
  const path = cookiePath === "" ? "/" : cookiePath;
  if (path === "/") {
    return true;
  }
  return currentPath === path || currentPath.startsWith(`${path}/`);
}

function domainMatches(host: string, cookieDomain: string): boolean {
  const normalisedDomain = cookieDomain.startsWith(".")
    ? cookieDomain.slice(1)
    : cookieDomain;
  return host === normalisedDomain || host.endsWith(`.${normalisedDomain}`);
}

function normaliseRequest(
  request: string | URL | CoreCacheRequest,
): CoreCacheRequest {
  if (typeof request === "string") {
    return { url: request, method: "GET" };
  }
  if (request instanceof URL) {
    return { url: request.toString(), method: "GET" };
  }
  return {
    url: request.url,
    method: request.method ?? "GET",
    headers: request.headers,
  };
}

function joinOPFSPath(base: string, name: string): string {
  const segments = [...splitPath(base), ...splitPath(name)];
  return segments.join("/");
}

function splitPath(value: string): string[] {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      if (segment === "." || segment === "..") {
        throw new Error("OPFS path traversal is not allowed");
      }
      return segment;
    });
}

function storageNamespace(origin: string, surface: string): string {
  return `${namespacePrefix}:${normaliseOrigin(origin)}:${surface}`;
}

function normaliseOrigin(origin: string): string {
  return origin.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function defineProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function defineGetter(
  target: Record<string, unknown>,
  key: string,
  get: () => unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get,
  });
}

function upsertCookie(
  cookies: CoreCookieRecord[],
  record: CoreCookieRecord,
): CoreCookieRecord[] {
  const next = cookies.filter((cookie) =>
    cookie.name !== record.name ||
    cookie.path !== record.path ||
    cookie.domain !== record.domain
  );
  next.push(record);
  return next;
}

function removeCookie(
  cookies: CoreCookieRecord[],
  name: string,
  options?: Pick<CoreCookieRecord, "path" | "domain">,
): CoreCookieRecord[] {
  return cookies.filter((cookie) => {
    if (cookie.name !== name) {
      return true;
    }
    if (options?.path !== undefined && cookie.path !== options.path) {
      return true;
    }
    if (options?.domain !== undefined && cookie.domain !== options.domain) {
      return true;
    }
    return false;
  });
}
