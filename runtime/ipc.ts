export type CoreRPCMethod =
  | "LocaleGet"
  | "StoreGet"
  | "StoreSet"
  | "FileRead"
  | "FileWrite"
  | "FileList"
  | "FileDelete"
  | "ProcessStart"
  | "ProcessStop";

export interface CoreRPCParams {
  LocaleGet: { locale: string };
  StoreGet: { group: string; key: string };
  StoreSet: { group: string; key: string; value: string };
  FileRead: { path: string };
  FileWrite: { path: string; content: string };
  FileList: { path: string };
  FileDelete: { path: string };
  ProcessStart: { command: string; args: string[] };
  ProcessStop: { process_id: string };
}

export interface CoreRPCResults {
  LocaleGet: unknown;
  StoreGet: unknown;
  StoreSet: unknown;
  FileRead: unknown;
  FileWrite: unknown;
  FileList: unknown;
  FileDelete: unknown;
  ProcessStart: unknown;
  ProcessStop: unknown;
}

export interface IPCReadyMessage {
  type: "ready";
}

export interface IPCLoadMessage {
  type: "load";
  url: string;
}

export interface IPCLoadedMessage {
  type: "loaded";
  ok: boolean;
  error?: string;
}

export interface IPCRequestMessage<
  TMethod extends CoreRPCMethod = CoreRPCMethod,
> {
  type: "rpc";
  id: number;
  method: TMethod;
  params: CoreRPCParams[TMethod];
}

export interface IPCResponseMessage<
  TMethod extends CoreRPCMethod = CoreRPCMethod,
> {
  type: "rpc_response";
  id: number;
  result?: CoreRPCResults[TMethod];
  error?: string;
}

export type RuntimeIPCMessage =
  | IPCReadyMessage
  | IPCLoadMessage
  | IPCLoadedMessage
  | IPCRequestMessage
  | IPCResponseMessage;

export interface RuntimeIPCChannel {
  post(message: RuntimeIPCMessage): void;
}

export interface WorkerCoreBridge {
  localeGet(locale: string): Promise<unknown>;
  storeGet(group: string, key: string): Promise<unknown>;
  storeSet(group: string, key: string, value: string): Promise<unknown>;
  fileRead(path: string): Promise<unknown>;
  fileWrite(path: string, content: string): Promise<unknown>;
  fileList(path: string): Promise<unknown>;
  fileDelete(path: string): Promise<unknown>;
  processStart(command: string, args: string[]): Promise<unknown>;
  processStop(processId: string): Promise<unknown>;
}

export class RuntimeRPCClient {
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  private nextID = 0;

  constructor(private readonly channel: RuntimeIPCChannel) {}

  request<TMethod extends CoreRPCMethod>(
    method: TMethod,
    params: CoreRPCParams[TMethod],
  ): Promise<CoreRPCResults[TMethod]> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextID;
      this.pending.set(id, {
        resolve,
        reject,
      });
      this.channel.post({
        type: "rpc",
        id,
        method,
        params,
      });
    });
  }

  handle(message: RuntimeIPCMessage): boolean {
    if (message.type !== "rpc_response") {
      return false;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return true;
    }

    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.result);
    }
    return true;
  }

  createCoreBridge(): WorkerCoreBridge {
    return {
      localeGet: (locale: string) => this.request("LocaleGet", { locale }),
      storeGet: (group: string, key: string) =>
        this.request("StoreGet", { group, key }),
      storeSet: (group: string, key: string, value: string) =>
        this.request("StoreSet", { group, key, value }),
      fileRead: (path: string) => this.request("FileRead", { path }),
      fileWrite: (path: string, content: string) =>
        this.request("FileWrite", { path, content }),
      fileList: (path: string) => this.request("FileList", { path }),
      fileDelete: (path: string) => this.request("FileDelete", { path }),
      processStart: (command: string, args: string[]) =>
        this.request("ProcessStart", { command, args }),
      processStop: (process_id: string) =>
        this.request("ProcessStop", { process_id }),
    };
  }
}

export interface RuntimeHostBridgeOptions {
  onReady?(): void;
  onLoaded(message: IPCLoadedMessage): void;
  dispatch(
    method: CoreRPCMethod,
    params: CoreRPCParams[CoreRPCMethod],
  ): Promise<unknown>;
}

export class RuntimeHostBridge {
  constructor(
    private readonly channel: RuntimeIPCChannel,
    private readonly options: RuntimeHostBridgeOptions,
  ) {}

  async handle(message: RuntimeIPCMessage): Promise<boolean> {
    if (message.type === "ready") {
      this.options.onReady?.();
      return true;
    }

    if (message.type === "loaded") {
      this.options.onLoaded(message);
      return true;
    }

    if (message.type !== "rpc") {
      return false;
    }

    try {
      const result = await this.options.dispatch(
        message.method,
        message.params,
      );
      this.channel.post({
        type: "rpc_response",
        id: message.id,
        result,
      });
    } catch (error) {
      this.channel.post({
        type: "rpc_response",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
}
