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
  headers?: Record<string, string> | Headers;
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
  names?(origin: string): Promise<string[]>;
  deleteCache?(origin: string, cacheName: string): Promise<void>;
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

export interface CoreCreateWritableOptions {
  keepExistingData?: boolean;
}

export type CoreWritableFileWriteData =
  | string
  | Uint8Array
  | ArrayBufferLike
  | {
    type: "write";
    data: string | Uint8Array | ArrayBufferLike;
    position?: number;
  }
  | {
    type: "seek";
    position: number;
  }
  | {
    type: "truncate";
    size: number;
  };

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
  [key: string]: unknown;
  localStorage?: unknown;
  sessionStorage?: unknown;
  indexedDB?: unknown;
  caches?: unknown;
  navigator?: unknown;
  document?: unknown;
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
  ready: Promise<void>;
}

interface BrowserStorageFacade {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

interface StorageFacadeBundle {
  facade: BrowserStorageFacade;
  ready: Promise<void>;
}

export interface CoreIndexedDBDatabase {
  origin: string;
  name: string;
  version?: number;
  raw: CoreIndexedDBConnection;
}

export interface CoreIndexedDBObjectStoreOptions {
  keyPath?: string | string[];
  autoIncrement?: boolean;
}

export interface CoreIndexedDBIndexOptions {
  unique?: boolean;
  multiEntry?: boolean;
}

export type CoreIndexedDBTransactionMode =
  | "readonly"
  | "readwrite"
  | "versionchange";

interface IndexedDBState {
  version: number;
  stores: Map<string, IndexedDBObjectStoreState>;
}

interface IndexedDBObjectStoreState {
  keyPath?: string | string[];
  autoIncrement?: boolean;
  nextKey: number;
  records: Map<string, unknown>;
  indexes: Map<string, IndexedDBIndexState>;
}

interface IndexedDBIndexState {
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}

interface PersistedIndexedDBState {
  version: number;
  stores: PersistedIndexedDBObjectStoreState[];
}

interface PersistedIndexedDBObjectStoreState {
  name: string;
  keyPath?: string | string[];
  autoIncrement?: boolean;
  nextKey: number;
  records: Array<[string, unknown]>;
  indexes: PersistedIndexedDBIndexState[];
}

interface PersistedIndexedDBIndexState {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}

interface IndexedDBMutationContext {
  readonly mode: CoreIndexedDBTransactionMode;
  markDirty(): void;
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

  private bucket(
    type: "success" | "error",
  ): Set<CoreIndexedDBRequestHandler<T>> {
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

function createStorageFacade(storage: CoreLocalStorage): StorageFacadeBundle {
  type StorageSource = CoreLocalStorage & {
    bridge: CoreStorageBridge;
    namespace: string;
  };

  const source = storage as unknown as StorageSource;
  const cache = new Map<string, string>();
  let hydrated = false;
  let hydration: Promise<void> | null = null;
  const mutations: Array<StorageMutation> = [];

  const hydrate = (): Promise<void> => {
    if (hydration) {
      return hydration;
    }

    hydration = (async () => {
      const nextCache = new Map<string, string>();
      const keys = await source.bridge.store.list(source.namespace);
      for (const key of keys) {
        const value = await source.bridge.store.get(source.namespace, key);
        if (value !== null) {
          nextCache.set(key, value);
        }
      }

      // Replay all local writes so the optimistic in-memory view wins over the
      // remote snapshot that arrived afterwards.
      for (const mutation of mutations) {
        applyStorageMutation(nextCache, mutation);
      }

      cache.clear();
      for (const [key, value] of nextCache) {
        cache.set(key, value);
      }
      hydrated = true;
      mutations.length = 0;
    })();
    void hydration.catch(() => undefined);

    return hydration;
  };

  const ready = hydrate();
  void ready.catch(() => undefined);

  return {
    ready,
    facade: {
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
        recordStorageMutation(mutations, {
          kind: "set",
          key,
          value,
        });
        cache.set(key, value);
        void source.setItem(key, value).catch(() => {
          // Keep the optimistic in-memory view available even if the bridge fails.
        });
      },
      removeItem(key: string): void {
        recordStorageMutation(mutations, {
          kind: "delete",
          key,
        });
        cache.delete(key);
        void source.removeItem(key).catch(() => {
          // Keep the optimistic in-memory view available even if the bridge fails.
        });
      },
      clear(): void {
        recordStorageMutation(mutations, {
          kind: "clear",
        });
        cache.clear();
        void source.clear().catch(() => {
          // Keep the optimistic in-memory view available even if the bridge fails.
        });
      },
    },
  };
}

export class CoreSessionStorage extends CoreLocalStorage {
  constructor(
    origin: string,
    bridge: CoreStorageBridge,
    private readonly sessionId: string,
  ) {
    super(origin, bridge, storageNamespace(origin, "session", sessionId));
  }

  override async setItem(key: string, value: string): Promise<void> {
    await this.bridge.store.set(this.namespace, key, value, {
      ttl: "session",
      sessionId: this.sessionId,
    });
  }
}

export class CoreIndexedDB {
  private readonly databaseStates = new Map<string, IndexedDBState>();

  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
  ) {}

  open(
    name: string,
    version?: number,
  ): CoreIndexedDBRequest<CoreIndexedDBDatabase> {
    const request = new CoreIndexedDBRequest<CoreIndexedDBDatabase>();
    void (async () => {
      try {
        const database = await this.getOrCreateDatabase(name, version);
        if (this.bridge.indexedDB?.open) {
          await this.bridge.indexedDB.open(this.origin, name, database.version);
        }
        request.resolve({
          origin: this.origin,
          name,
          version: database.version,
          raw: new CoreIndexedDBConnection(
            this.origin,
            name,
            database,
            () => this.persistDatabase(name, database),
          ),
        });
      } catch (error) {
        request.reject(error);
      }
    })();
    return request;
  }

  async deleteDatabase(name: string): Promise<void> {
    this.databaseStates.delete(name);
    await this.bridge.store.delete(indexedDBNamespace(this.origin), name);
    if (this.bridge.indexedDB?.deleteDatabase) {
      await this.bridge.indexedDB.deleteDatabase(this.origin, name);
    }
  }

  async databases(): Promise<string[]> {
    const names = new Set(this.databaseStates.keys());
    for (
      const name of await this.bridge.store.list(
        indexedDBNamespace(this.origin),
      )
    ) {
      names.add(name);
    }
    if (this.bridge.indexedDB?.databases) {
      for (const name of await this.bridge.indexedDB.databases(this.origin)) {
        names.add(name);
      }
    }
    return Array.from(names);
  }

  private async getOrCreateDatabase(
    name: string,
    version?: number,
  ): Promise<IndexedDBState> {
    const existing = this.databaseStates.get(name);
    if (!existing) {
      const database = await this.loadDatabase(name) ?? {
        version: version ?? 1,
        stores: new Map<string, IndexedDBObjectStoreState>(),
      };
      let changed = false;
      if (version !== undefined && version > database.version) {
        database.version = version;
        changed = true;
      }
      this.databaseStates.set(name, database);
      if (changed || database.stores.size === 0) {
        await this.persistDatabase(name, database);
      }
      return database;
    }

    if (version !== undefined && version < existing.version) {
      throw new Error(
        `VersionError: requested version ${version} is lower than existing version ${existing.version}`,
      );
    }

    if (version !== undefined && version > existing.version) {
      existing.version = version;
      await this.persistDatabase(name, existing);
    }

    return existing;
  }

  private async loadDatabase(name: string): Promise<IndexedDBState | null> {
    const payload = await this.bridge.store.get(
      indexedDBNamespace(this.origin),
      name,
    );
    if (payload === null) {
      return null;
    }
    return parsePersistedIndexedDBState(payload);
  }

  private async persistDatabase(
    name: string,
    database: IndexedDBState,
  ): Promise<void> {
    await this.bridge.store.set(
      indexedDBNamespace(this.origin),
      name,
      JSON.stringify(serialiseIndexedDBState(database)),
    );
  }
}

export class CoreIndexedDBConnection {
  constructor(
    readonly origin: string,
    readonly name: string,
    private readonly database: IndexedDBState,
    private readonly persist: () => Promise<void>,
  ) {}

  get version(): number {
    return this.database.version;
  }

  get objectStoreNames(): string[] {
    return Array.from(this.database.stores.keys());
  }

  close(): void {
    // The in-memory polyfill does not retain explicit connection state.
  }

  createObjectStore(
    name: string,
    options: CoreIndexedDBObjectStoreOptions = {},
  ): CoreIndexedDBObjectStore {
    if (this.database.stores.has(name)) {
      throw new Error(`object store already exists: ${name}`);
    }
    const store = {
      keyPath: options.keyPath,
      autoIncrement: options.autoIncrement ?? false,
      nextKey: 1,
      records: new Map<string, unknown>(),
      indexes: new Map<string, IndexedDBIndexState>(),
    };
    this.database.stores.set(name, store);
    void this.persist().catch(() => undefined);
    return new CoreIndexedDBObjectStore(this.database, store, name, {
      mode: "versionchange",
      markDirty: () => {
        void this.persist().catch(() => undefined);
      },
    });
  }

  deleteObjectStore(name: string): void {
    this.database.stores.delete(name);
    void this.persist().catch(() => undefined);
  }

  transaction(
    storeNames: string | string[],
    mode: CoreIndexedDBTransactionMode = "readonly",
  ): CoreIndexedDBTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const name of names) {
      if (!this.database.stores.has(name)) {
        throw new Error(`unknown object store: ${name}`);
      }
    }
    return new CoreIndexedDBTransaction(
      this.database,
      names,
      mode,
      this.persist,
    );
  }
}

export class CoreIndexedDBTransaction {
  private aborted = false;
  private committed = false;
  private dirty = false;
  private readonly stagedStores = new Map<string, IndexedDBObjectStoreState>();
  readonly done: Promise<void>;

  constructor(
    private readonly database: IndexedDBState,
    readonly storeNames: string[],
    readonly mode: CoreIndexedDBTransactionMode,
    private readonly persist: () => Promise<void>,
  ) {
    this.done = Promise.resolve();
    if (mode !== "readonly") {
      for (const name of storeNames) {
        const store = this.database.stores.get(name);
        if (store) {
          this.stagedStores.set(name, cloneObjectStoreState(store));
        }
      }
    }
  }

  objectStore(name: string): CoreIndexedDBObjectStore {
    if (!this.storeNames.includes(name)) {
      throw new Error(`transaction does not include object store: ${name}`);
    }
    const store = this.database.stores.get(name);
    if (!store) {
      throw new Error(`unknown object store: ${name}`);
    }
    return new CoreIndexedDBObjectStore(
      this.database,
      this.mode === "readonly" ? store : this.stagedStores.get(name) ?? store,
      name,
      {
        mode: this.mode,
        markDirty: () => {
          this.dirty = true;
        },
      },
    );
  }

  abort(): void {
    this.aborted = true;
    this.dirty = false;
  }

  commit(): void {
    if (this.aborted) {
      throw new Error("transaction was aborted");
    }
    if (this.committed || this.mode === "readonly") {
      this.committed = true;
      return;
    }
    for (const [name, store] of this.stagedStores) {
      this.database.stores.set(name, cloneObjectStoreState(store));
    }
    this.committed = true;
    if (this.dirty) {
      void this.persist().catch(() => undefined);
    }
  }
}

export class CoreIndexedDBObjectStore {
  constructor(
    private readonly database: IndexedDBState,
    private readonly store: IndexedDBObjectStoreState,
    readonly name: string,
    private readonly mutationContext: IndexedDBMutationContext = {
      mode: "versionchange",
      markDirty: () => undefined,
    },
  ) {}

  get keyPath(): string | string[] | undefined {
    return this.store.keyPath;
  }

  get autoIncrement(): boolean {
    return this.store.autoIncrement ?? false;
  }

  get indexNames(): string[] {
    return Array.from(this.store.indexes.keys());
  }

  createIndex(
    name: string,
    keyPath: string | string[],
    options: CoreIndexedDBIndexOptions = {},
  ): CoreIndexedDBIndex {
    this.assertWritable();
    if (this.store.indexes.has(name)) {
      throw new Error(`index already exists: ${name}`);
    }
    this.store.indexes.set(name, {
      keyPath,
      unique: options.unique ?? false,
      multiEntry: options.multiEntry ?? false,
    });
    this.mutationContext.markDirty();
    return new CoreIndexedDBIndex(this.database, this.store, name);
  }

  deleteIndex(name: string): void {
    this.assertWritable();
    this.store.indexes.delete(name);
    this.mutationContext.markDirty();
  }

  index(name: string): CoreIndexedDBIndex {
    if (!this.store.indexes.has(name)) {
      throw new Error(`unknown index: ${name}`);
    }
    return new CoreIndexedDBIndex(this.database, this.store, name);
  }

  get(key: unknown): CoreIndexedDBRequest<unknown | null> {
    return this.createRequest<unknown | null>(() => this.readRecord(key));
  }

  getAll(
    query?: unknown,
    count?: number,
  ): CoreIndexedDBRequest<unknown[]> {
    return this.createRequest<unknown[]>(() => {
      const records = this.listRecords(query);
      return count === undefined ? records : records.slice(0, count);
    });
  }

  getAllKeys(
    query?: unknown,
    count?: number,
  ): CoreIndexedDBRequest<unknown[]> {
    return this.createRequest<unknown[]>(() => {
      const entries = this.listEntries(query);
      const keys = entries.map(([primaryKey]) => this.decodeKey(primaryKey));
      return count === undefined ? keys : keys.slice(0, count);
    });
  }

  count(query?: unknown): CoreIndexedDBRequest<number> {
    return this.createRequest<number>(() => this.listEntries(query).length);
  }

  put(value: unknown, key?: unknown): CoreIndexedDBRequest<unknown> {
    return this.createRequest<unknown>(() =>
      this.writeRecord(value, key, false)
    );
  }

  add(value: unknown, key?: unknown): CoreIndexedDBRequest<unknown> {
    return this.createRequest<unknown>(() =>
      this.writeRecord(value, key, true)
    );
  }

  delete(key: unknown): CoreIndexedDBRequest<void> {
    return this.createRequest<void>(() => {
      this.assertWritable();
      this.store.records.delete(this.encodeKey(key));
      this.mutationContext.markDirty();
    });
  }

  clear(): CoreIndexedDBRequest<void> {
    return this.createRequest<void>(() => {
      this.assertWritable();
      this.store.records.clear();
      this.mutationContext.markDirty();
    });
  }

  openCursor(
    query?: unknown,
  ): CoreIndexedDBRequest<CoreIndexedDBCursor | null> {
    return this.createRequest<CoreIndexedDBCursor | null>(() => {
      const entries = this.listEntries(query);
      if (entries.length === 0) {
        return null;
      }
      return new CoreIndexedDBCursor(
        this.createRequest.bind(this),
        this.decodeKey.bind(this),
        entries,
        0,
      );
    });
  }

  private readRecord(key: unknown): unknown | null {
    return this.store.records.get(this.encodeKey(key)) ?? null;
  }

  private writeRecord(
    value: unknown,
    key: unknown,
    requireNew: boolean,
  ): unknown {
    this.assertWritable();
    const primaryKey = this.resolvePrimaryKey(value, key);
    const encodedKey = this.encodeKey(primaryKey);
    if (requireNew && this.store.records.has(encodedKey)) {
      throw new Error(`key already exists: ${String(primaryKey)}`);
    }
    this.store.records.set(encodedKey, this.cloneValue(value));
    this.mutationContext.markDirty();
    return primaryKey;
  }

  private assertWritable(): void {
    if (this.mutationContext.mode === "readonly") {
      throw new Error(`object store is readonly: ${this.name}`);
    }
  }

  private resolvePrimaryKey(value: unknown, key?: unknown): unknown {
    if (key !== undefined) {
      return key;
    }

    if (this.store.keyPath !== undefined) {
      const derived = this.readKeyPath(value, this.store.keyPath);
      if (derived !== undefined) {
        return derived;
      }
    }

    if (this.store.autoIncrement) {
      return this.store.nextKey++;
    }

    throw new Error(`key required for object store: ${this.name}`);
  }

  private readKeyPath(
    value: unknown,
    keyPath: string | string[],
  ): unknown | undefined {
    if (!isRecord(value)) {
      return undefined;
    }
    if (Array.isArray(keyPath)) {
      return keyPath.map((part) => this.readKeyPart(value, part));
    }
    return this.readKeyPart(value, keyPath);
  }

  private readKeyPart(
    value: Record<string, unknown>,
    keyPath: string,
  ): unknown | undefined {
    return keyPath.split(".").reduce<unknown | undefined>((current, part) => {
      if (!isRecord(current)) {
        return undefined;
      }
      return current[part];
    }, value);
  }

  private listRecords(query?: unknown): unknown[] {
    return this.listEntries(query).map(([, value]) => this.cloneValue(value));
  }

  private listEntries(query?: unknown): Array<[string, unknown]> {
    const entries = Array.from(this.store.records.entries());
    if (query === undefined) {
      return entries;
    }
    return entries.filter(([primaryKey, value]) =>
      this.matchesQuery(primaryKey, value, query)
    );
  }

  private matchesQuery(
    primaryKey: string,
    value: unknown,
    query: unknown,
  ): boolean {
    if (isRecord(query) && "key" in query) {
      return this.encodeKey((query as { key: unknown }).key) === primaryKey;
    }
    return this.encodeKey(value) === this.encodeKey(query);
  }

  private createRequest<T>(factory: () => T): CoreIndexedDBRequest<T> {
    const request = new CoreIndexedDBRequest<T>();
    queueMicrotask(() => {
      try {
        request.resolve(factory());
      } catch (error) {
        request.reject(error);
      }
    });
    return request;
  }

  private encodeKey(key: unknown): string {
    if (key instanceof Date) {
      return `date:${key.toISOString()}`;
    }
    if (typeof key === "string") {
      return `string:${key}`;
    }
    if (typeof key === "number") {
      return `number:${key}`;
    }
    if (typeof key === "bigint") {
      return `bigint:${key.toString()}`;
    }
    if (typeof key === "boolean") {
      return `boolean:${key ? "1" : "0"}`;
    }
    return `json:${JSON.stringify(key)}`;
  }

  private decodeKey(encodedKey: string): unknown {
    const separator = encodedKey.indexOf(":");
    if (separator === -1) {
      return encodedKey;
    }
    const type = encodedKey.slice(0, separator);
    const value = encodedKey.slice(separator + 1);
    switch (type) {
      case "string":
        return value;
      case "number":
        return Number(value);
      case "bigint":
        return BigInt(value);
      case "boolean":
        return value === "1";
      case "date":
        return new Date(value);
      case "json":
        return JSON.parse(value);
      default:
        return value;
    }
  }

  private cloneValue<T>(value: T): T {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export class CoreIndexedDBIndex {
  constructor(
    private readonly database: IndexedDBState,
    private readonly store: IndexedDBObjectStoreState,
    readonly name: string,
  ) {}

  get(key: unknown): CoreIndexedDBRequest<unknown | null> {
    return this.createRequest<unknown | null>(() =>
      this.findMatches(key)[0] ?? null
    );
  }

  getAll(key?: unknown, count?: number): CoreIndexedDBRequest<unknown[]> {
    return this.createRequest<unknown[]>(() => {
      const matches = this.findMatches(key);
      return count === undefined ? matches : matches.slice(0, count);
    });
  }

  count(key?: unknown): CoreIndexedDBRequest<number> {
    return this.createRequest<number>(() => this.findMatches(key).length);
  }

  private findMatches(key?: unknown): unknown[] {
    const definition = this.store.indexes.get(this.name);
    if (!definition) {
      return [];
    }

    const matches: unknown[] = [];
    for (const value of this.store.records.values()) {
      const indexValues = this.extractIndexValues(value, definition.keyPath);
      if (key === undefined) {
        matches.push(this.cloneValue(value));
        continue;
      }
      if (
        indexValues.some((candidate) =>
          this.encodeKey(candidate) === this.encodeKey(key)
        )
      ) {
        matches.push(this.cloneValue(value));
      }
    }
    return matches;
  }

  private extractIndexValues(
    value: unknown,
    keyPath: string | string[],
  ): unknown[] {
    if (Array.isArray(keyPath)) {
      return keyPath.map((part) => this.extractIndexValue(value, part)).filter((
        candidate,
      ): candidate is unknown => candidate !== undefined);
    }
    const extracted = this.extractIndexValue(value, keyPath);
    return extracted === undefined ? [] : [extracted];
  }

  private extractIndexValue(
    value: unknown,
    keyPath: string,
  ): unknown | undefined {
    if (!isRecord(value)) {
      return undefined;
    }
    return keyPath.split(".").reduce<unknown | undefined>((current, part) => {
      if (!isRecord(current)) {
        return undefined;
      }
      return current[part];
    }, value);
  }

  private createRequest<T>(factory: () => T): CoreIndexedDBRequest<T> {
    const request = new CoreIndexedDBRequest<T>();
    queueMicrotask(() => {
      try {
        request.resolve(factory());
      } catch (error) {
        request.reject(error);
      }
    });
    return request;
  }

  private encodeKey(key: unknown): string {
    if (key instanceof Date) {
      return `date:${key.toISOString()}`;
    }
    if (typeof key === "string") {
      return `string:${key}`;
    }
    if (typeof key === "number") {
      return `number:${key}`;
    }
    if (typeof key === "bigint") {
      return `bigint:${key.toString()}`;
    }
    if (typeof key === "boolean") {
      return `boolean:${key ? "1" : "0"}`;
    }
    return `json:${JSON.stringify(key)}`;
  }

  private cloneValue<T>(value: T): T {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export class CoreIndexedDBCursor {
  constructor(
    private readonly createRequest: <T>(
      factory: () => T,
    ) => CoreIndexedDBRequest<T>,
    private readonly decodeKey: (encodedKey: string) => unknown,
    private readonly entries: Array<[string, unknown]>,
    private index: number,
  ) {}

  get key(): unknown {
    return this.decodeKey(this.entries[this.index]?.[0] ?? "") ?? null;
  }

  get value(): unknown {
    return this.entries[this.index]?.[1] ?? null;
  }

  continue(): CoreIndexedDBRequest<CoreIndexedDBCursor | null> {
    return this.createRequest(() => {
      const nextIndex = this.index + 1;
      if (nextIndex >= this.entries.length) {
        return null;
      }
      return new CoreIndexedDBCursor(
        this.createRequest,
        this.decodeKey,
        this.entries,
        nextIndex,
      );
    });
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
  ) {
    const context = cookieContextFromOrigin(origin);
    this.currentPath = context.path;
    this.secureContext = context.secure;
  }

  snapshot(): string {
    return this.snapshotValue;
  }

  async refresh(
    currentPath = this.currentPath,
    secure = this.secureContext,
  ): Promise<string> {
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
    // Preserve browser behaviour: document.cookie cannot create HttpOnly
    // cookies, even though the parser keeps the flag for bridge-side callers.
    delete record.httpOnly;
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

  async add(
    request: string | URL | Request,
    init?: RequestInit,
  ): Promise<void> {
    const response = await fetch(request, init);
    if (!response.ok) {
      throw new Error(`cache add failed with status ${response.status}`);
    }
    await this.put(request, await responseToCacheRecord(response));
  }

  async addAll(
    requests: Array<string | URL | Request>,
  ): Promise<void> {
    for (const request of requests) {
      await this.add(request);
    }
  }

  async put(
    request: string | URL | Request | CoreCacheRequest,
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
    request: string | URL | Request | CoreCacheRequest,
  ): Promise<CoreCacheResponse | null> {
    return this.requireBridge().match(
      this.origin,
      this.name,
      normaliseRequest(request),
    );
  }

  async matchAll(
    request?: string | URL | Request | CoreCacheRequest,
  ): Promise<CoreCacheResponse[]> {
    if (request !== undefined) {
      const response = await this.match(request);
      return response ? [response] : [];
    }

    const matches: CoreCacheResponse[] = [];
    for (const cachedRequest of await this.keys()) {
      const response = await this.match(cachedRequest);
      if (response) {
        matches.push(response);
      }
    }
    return matches;
  }

  async delete(
    request: string | URL | Request | CoreCacheRequest,
  ): Promise<boolean> {
    return this.requireBridge().delete(
      this.origin,
      this.name,
      normaliseRequest(request),
    );
  }

  async keys(
    request?: string | URL | Request | CoreCacheRequest,
  ): Promise<CoreCacheRequest[]> {
    const requests = await this.requireBridge().keys(this.origin, this.name);
    if (request === undefined) {
      return requests;
    }

    const target = normaliseRequest(request);
    return requests.filter((entry) => requestMatches(entry, target));
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
    request: string | URL | Request | CoreCacheRequest,
  ): Promise<CoreCacheResponse | null> {
    const normalisedRequest = normaliseRequest(request);

    for (const cache of this.caches.values()) {
      const response = await cache.match(normalisedRequest);
      if (response) {
        return response;
      }
    }

    const bridge = this.requireBridge();
    if (!bridge.names) {
      return null;
    }

    const localNames = new Set(this.caches.keys());
    for (const cacheName of await bridge.names(this.origin)) {
      if (localNames.has(cacheName)) {
        continue;
      }
      const response = await bridge.match(
        this.origin,
        cacheName,
        normalisedRequest,
      );
      if (response) {
        return response;
      }
    }

    return null;
  }

  async delete(cacheName: string): Promise<boolean> {
    const cache = this.caches.get(cacheName);
    if (cache) {
      const requests = await cache.keys();
      for (const request of requests) {
        await cache.delete(request);
      }
    }

    const bridge = this.requireBridge();
    if (bridge.deleteCache) {
      await bridge.deleteCache(this.origin, cacheName);
    }

    this.caches.delete(cacheName);
    return cache !== undefined || bridge.deleteCache !== undefined;
  }

  async keys(): Promise<string[]> {
    const local = [...this.caches.keys()];
    const bridge = this.requireBridge();
    if (!bridge.names) {
      return local;
    }

    const remote = await bridge.names(this.origin);
    return Array.from(new Set([...local, ...remote]));
  }

  async has(cacheName: string): Promise<boolean> {
    return (await this.keys()).includes(cacheName);
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
    private readonly onDelete?: (name: string) => void,
  ) {}

  get quota(): number | undefined {
    return this.options?.quota;
  }

  get persisted(): boolean | undefined {
    return this.options?.persisted;
  }

  async delete(): Promise<void> {
    const buckets = this.requireBridge();
    await buckets.delete(this.origin, this.name);
    this.onDelete?.(this.name);
  }

  private requireBridge(): CoreBucketBridge {
    if (!this.bridge.buckets) {
      throw new Error("storage buckets bridge is not configured");
    }
    return this.bridge.buckets;
  }
}

export class CoreStorageBucketManager {
  private readonly buckets = new Map<string, CoreStorageBucket>();

  constructor(
    private readonly origin: string,
    private readonly bridge: CoreStorageBridge,
  ) {}

  async open(
    name: string,
    options?: StorageBucketOptions,
  ): Promise<CoreStorageBucket> {
    const existing = this.buckets.get(name);
    if (existing) {
      return existing;
    }
    const buckets = this.requireBridge();
    await buckets.open(this.origin, name, options);
    const bucket = new CoreStorageBucket(
      this.origin,
      this.bridge,
      name,
      options,
      (bucketName) => {
        this.buckets.delete(bucketName);
      },
    );
    this.buckets.set(name, bucket);
    return bucket;
  }

  async keys(): Promise<string[]> {
    const buckets = this.requireBridge();
    const local = Array.from(this.buckets.keys());
    if (!buckets.keys) {
      return local;
    }

    const remote = await buckets.keys(this.origin);
    const merged = new Set<string>(remote);
    for (const bucket of local) {
      merged.add(bucket);
    }
    return Array.from(merged);
  }

  async delete(name: string): Promise<void> {
    const buckets = this.requireBridge();
    await buckets.delete(this.origin, name);
    this.buckets.delete(name);
  }

  snapshot(): CoreStorageBucket[] {
    return Array.from(this.buckets.values());
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

  get kind(): "file" {
    return "file";
  }

  get name(): string {
    return lastPathSegment(this.path);
  }

  async getFile(): Promise<string | null> {
    return this.requireBridge().read(this.origin, this.path);
  }

  async write(content: string): Promise<void> {
    await this.requireBridge().write(this.origin, this.path, content);
  }

  async remove(): Promise<void> {
    await this.requireBridge().delete(this.origin, this.path);
  }

  async isSameEntry(handle: CoreFileHandle | CoreOPFS): Promise<boolean> {
    return handle instanceof CoreFileHandle &&
      handle.path === this.path &&
      handle.originValue() === this.origin;
  }

  // Example:
  //   const writer = await fileHandle.createWritable();
  //   await writer.write("hello");
  //   await writer.close();
  async createWritable(
    options: CoreCreateWritableOptions = {},
  ): Promise<CoreWritableFileStream> {
    const existing = options.keepExistingData === false
      ? ""
      : (await this.getFile()) ?? "";
    return new CoreWritableFileStream(this, existing);
  }

  originValue(): string {
    return this.origin;
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

  get kind(): "directory" {
    return "directory";
  }

  get name(): string {
    return lastPathSegment(this.path);
  }

  async getDirectoryHandle(
    name: string,
    options: FileSystemGetDirectoryOptions = {},
  ): Promise<CoreOPFS> {
    const nextPath = joinOPFSPath(this.path, name);
    if (options.create ?? false) {
      await ensureOPFSDirectories(this.requireBridge(), this.origin, nextPath);
    }
    return new CoreOPFS(this.origin, this.bridge, nextPath);
  }

  async getFileHandle(
    name: string,
    options: FileSystemGetFileOptions = {},
  ): Promise<CoreFileHandle> {
    const path = joinOPFSPath(this.path, name);
    if (options.create ?? false) {
      const fs = this.requireBridge();
      await ensureOPFSDirectories(fs, this.origin, parentOPFSPath(path));
      const existing = await fs.read(this.origin, path);
      if (existing === null) {
        await fs.write(this.origin, path, "");
      }
    }
    return new CoreFileHandle(this.origin, this.bridge, path);
  }

  async removeEntry(name: string): Promise<void> {
    await this.requireBridge().delete(
      this.origin,
      joinOPFSPath(this.path, name),
    );
  }

  async entries(): Promise<string[]> {
    return this.requireBridge().list(this.origin, this.path);
  }

  async isSameEntry(handle: CoreFileHandle | CoreOPFS): Promise<boolean> {
    return handle instanceof CoreOPFS &&
      handle.path === this.path &&
      handle.originValue() === this.origin;
  }

  // Example:
  //   const child = await root.getFileHandle("data.txt", { create: true });
  //   const relative = await root.resolve(child);
  //   // -> ["data.txt"]
  async resolve(handle: CoreFileHandle | CoreOPFS): Promise<string[] | null> {
    const targetPath = handle.path;
    const relativePath = descendantPath(this.path, targetPath);
    return relativePath === null ? null : splitPath(relativePath);
  }

  originValue(): string {
    return this.origin;
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
  private persistedState = false;

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
    const quota = this.bucketQuota();
    return quota === undefined ? {} : { quota, usage: 0 };
  }

  async persist(): Promise<boolean> {
    this.persistedState = true;
    return true;
  }

  async persisted(): Promise<boolean> {
    return this.persistedState || this.hasPersistedBucket();
  }

  get storageBuckets(): CoreStorageBucketManager {
    return this.buckets;
  }

  private bucketQuota(): number | undefined {
    const quota = this.bucketsQuota();
    return quota.length === 0
      ? undefined
      : quota.reduce((total, value) => total + value, 0);
  }

  private hasPersistedBucket(): boolean {
    return this.buckets.snapshot().some((bucket) => bucket.persisted === true);
  }

  private bucketsQuota(): number[] {
    const quotas: number[] = [];
    for (const bucket of this.buckets.snapshot()) {
      if (typeof bucket.quota === "number" && Number.isFinite(bucket.quota)) {
        quotas.push(bucket.quota);
      }
    }
    return quotas;
  }
}

export class CoreWritableFileStream {
  private buffer: string;
  private position: number;
  private closed = false;

  constructor(
    private readonly handle: CoreFileHandle,
    initialContent: string,
  ) {
    this.buffer = initialContent;
    this.position = initialContent.length;
  }

  async write(data: CoreWritableFileWriteData): Promise<void> {
    this.assertOpen();

    if (typeof data === "object" && data !== null && "type" in data) {
      switch (data.type) {
        case "seek":
          this.seek(data.position);
          return;
        case "truncate":
          this.truncate(data.size);
          return;
        case "write":
          this.writeAt(data.data, data.position);
          return;
      }
    }

    this.writeAt(data);
  }

  async seek(position: number): Promise<void> {
    this.assertOpen();
    if (!Number.isInteger(position) || position < 0) {
      throw new Error("write position must be a non-negative integer");
    }
    this.position = position;
  }

  async truncate(size: number): Promise<void> {
    this.assertOpen();
    if (!Number.isInteger(size) || size < 0) {
      throw new Error("truncate size must be a non-negative integer");
    }
    this.buffer = this.buffer.slice(0, size).padEnd(size, "\0");
    this.position = Math.min(this.position, size);
  }

  async close(): Promise<void> {
    this.assertOpen();
    await this.handle.write(this.buffer);
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.closed = true;
  }

  private writeAt(
    data: string | Uint8Array | ArrayBufferLike,
    position = this.position,
  ): void {
    if (!Number.isInteger(position) || position < 0) {
      throw new Error("write position must be a non-negative integer");
    }

    const chunk = normaliseWritableChunk(data);
    const padded = position > this.buffer.length
      ? this.buffer.padEnd(position, "\0")
      : this.buffer;
    this.buffer = `${padded.slice(0, position)}${chunk}${
      padded.slice(position + chunk.length)
    }`;
    this.position = position + chunk.length;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("writable file stream is closed");
    }
  }
}

export function injectStoragePolyfills(
  origin: string,
  bridge: CoreStorageBridge,
  options: InjectStoragePolyfillsOptions = {},
): CoreStoragePolyfills {
  const target = (
    options.target ?? (globalThis as unknown as CoreStoragePolyfillTarget)
  ) as Record<string, unknown> & CoreStoragePolyfillTarget;
  const cookieContext = cookieContextFromOrigin(origin);
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

  defineGetter(target, "localStorage", () => localStorageFacade.facade);
  defineGetter(target, "sessionStorage", () => sessionStorageFacade.facade);
  defineGetter(target, "indexedDB", () => indexedDB);
  defineGetter(target, "caches", () => caches);

  const navigatorTarget = isRecord(target.navigator) ? target.navigator : {};
  if (!isRecord(target.navigator)) {
    defineGetter(target, "navigator", () => navigatorTarget);
  }
  defineGetter(navigatorTarget, "storageBuckets", () => storageBuckets);
  defineGetter(navigatorTarget, "storage", () => storage);

  let cookieReady = Promise.resolve();
  if (target.document) {
    if (bridge.cookies) {
      cookieReady = cookies
        .refresh(cookieContext.path, cookieContext.secure)
        .then(() => undefined);
      void cookieReady.catch(() => undefined);
    }
    Object.defineProperty(target.document, "cookie", {
      configurable: true,
      enumerable: true,
      get: () => cookies.snapshot(),
      set: (value: string) => {
        void cookies.set(value).catch(() => undefined);
      },
    });
  }

  const ready = Promise.all([
    localStorageFacade.ready,
    sessionStorageFacade.ready,
    cookieReady,
  ]).then(() => undefined);
  void ready.catch(() => undefined);

  return {
    localStorage,
    sessionStorage,
    indexedDB,
    cookies,
    caches,
    storageBuckets,
    storage,
    ready,
  };
}

export function parseCookie(
  serialized: string,
  origin: string,
): CoreCookieRecord {
  const parts = serialized.split(";").map((part) => part.trim()).filter(
    Boolean,
  );
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

function cookieContextFromOrigin(origin: string): {
  path: string;
  secure: boolean;
} {
  try {
    const url = new URL(origin, "http://localhost/");
    return {
      path: url.pathname && url.pathname !== "" ? url.pathname : "/",
      secure: url.protocol !== "http:" &&
        url.protocol !== "ws:" &&
        url.protocol !== "file:",
    };
  } catch {
    return {
      path: "/",
      secure: false,
    };
  }
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
  request: string | URL | Request | CoreCacheRequest,
): CoreCacheRequest {
  if (typeof request === "string") {
    return { url: request, method: "GET" };
  }
  if (request instanceof URL) {
    return { url: request.toString(), method: "GET" };
  }
  if (typeof Request !== "undefined" && request instanceof Request) {
    return {
      url: request.url,
      method: request.method,
      headers: normaliseHeaders(request.headers),
    };
  }
  return {
    url: request.url,
    method: request.method ?? "GET",
    headers: normaliseHeaders(request.headers),
  };
}

function normaliseHeaders(
  headers?: Record<string, string> | Headers,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries()) as Record<string, string>;
  }
  return headers;
}

async function responseToCacheRecord(
  response: Response,
): Promise<CoreCacheResponse> {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.clone().text(),
  };
}

function requestMatches(
  candidate: CoreCacheRequest,
  target: CoreCacheRequest,
): boolean {
  return candidate.url === target.url &&
    (candidate.method ?? "GET") === (target.method ?? "GET");
}

function joinOPFSPath(base: string, name: string): string {
  const segments = [...splitPath(base), ...splitPath(name)];
  return segments.join("/");
}

function parentOPFSPath(path: string): string {
  const segments = splitPath(path);
  if (segments.length <= 1) {
    return "";
  }
  return segments.slice(0, -1).join("/");
}

async function ensureOPFSDirectories(
  bridge: CoreFileBridge,
  origin: string,
  path: string,
): Promise<void> {
  const segments = splitPath(path);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    await bridge.mkdir(origin, current);
  }
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

function lastPathSegment(path: string): string {
  const segments = splitPath(path);
  return segments[segments.length - 1] ?? "";
}

function descendantPath(basePath: string, targetPath: string): string | null {
  const base = splitPath(basePath);
  const target = splitPath(targetPath);

  if (base.length > target.length) {
    return null;
  }
  for (let index = 0; index < base.length; index += 1) {
    if (base[index] !== target[index]) {
      return null;
    }
  }
  return target.slice(base.length).join("/");
}

function normaliseWritableChunk(
  data: string | Uint8Array | ArrayBufferLike,
): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data);
  }
  return new TextDecoder().decode(new Uint8Array(data));
}

function indexedDBNamespace(origin: string): string {
  return storageNamespace(origin, "indexeddb");
}

function cloneObjectStoreState(
  store: IndexedDBObjectStoreState,
): IndexedDBObjectStoreState {
  return {
    keyPath: cloneJSONValue(store.keyPath),
    autoIncrement: store.autoIncrement,
    nextKey: store.nextKey,
    records: new Map(
      Array.from(
        store.records.entries(),
        ([key, value]) => [key, cloneJSONValue(value)],
      ),
    ),
    indexes: new Map(
      Array.from(store.indexes.entries(), ([name, index]) => [
        name,
        {
          keyPath: cloneJSONValue(index.keyPath),
          unique: index.unique,
          multiEntry: index.multiEntry,
        },
      ]),
    ),
  };
}

function serialiseIndexedDBState(
  database: IndexedDBState,
): PersistedIndexedDBState {
  return {
    version: database.version,
    stores: Array.from(database.stores.entries(), ([name, store]) => ({
      name,
      keyPath: cloneJSONValue(store.keyPath),
      autoIncrement: store.autoIncrement,
      nextKey: store.nextKey,
      records: Array.from(
        store.records.entries(),
        ([key, value]) => [key, cloneJSONValue(value)] as [string, unknown],
      ),
      indexes: Array.from(store.indexes.entries(), ([indexName, index]) => ({
        name: indexName,
        keyPath: cloneJSONValue(index.keyPath),
        unique: index.unique,
        multiEntry: index.multiEntry,
      })),
    })),
  };
}

function parsePersistedIndexedDBState(payload: string): IndexedDBState {
  const parsed = JSON.parse(payload) as PersistedIndexedDBState;
  return {
    version: parsed.version ?? 1,
    stores: new Map(
      (parsed.stores ?? []).map((store) => [
        store.name,
        {
          keyPath: cloneJSONValue(store.keyPath),
          autoIncrement: store.autoIncrement,
          nextKey: store.nextKey ?? 1,
          records: new Map(
            (store.records ?? []).map((
              [key, value],
            ) => [key, cloneJSONValue(value)]),
          ),
          indexes: new Map(
            (store.indexes ?? []).map((index) => [
              index.name,
              {
                keyPath: cloneJSONValue(index.keyPath),
                unique: Boolean(index.unique),
                multiEntry: Boolean(index.multiEntry),
              },
            ]),
          ),
        } satisfies IndexedDBObjectStoreState,
      ]),
    ),
  };
}

function cloneJSONValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function storageNamespace(origin: string, ...parts: string[]): string {
  const suffix = parts
    .map((part) => normaliseNamespacePart(part))
    .filter((part) => part.length > 0)
    .join(":");
  return suffix === ""
    ? `${namespacePrefix}:${normaliseOrigin(origin)}`
    : `${namespacePrefix}:${normaliseOrigin(origin)}:${suffix}`;
}

function normaliseOrigin(origin: string): string {
  return origin.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function normaliseNamespacePart(part: string): string {
  return part.replace(/[^a-zA-Z0-9._-]+/g, "_");
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

type StorageMutation =
  | { kind: "set"; key: string; value: string }
  | { kind: "delete"; key: string }
  | { kind: "clear" };

function recordStorageMutation(
  mutations: StorageMutation[],
  mutation: StorageMutation,
): void {
  mutations.push(mutation);
}

function applyStorageMutation(
  cache: Map<string, string>,
  mutation: StorageMutation,
): void {
  switch (mutation.kind) {
    case "set":
      cache.set(mutation.key, mutation.value);
      return;
    case "delete":
      cache.delete(mutation.key);
      return;
    case "clear":
      cache.clear();
      return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
