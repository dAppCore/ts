import { loadHyperswarm } from "../deps.ts";
import { CoreEventBus } from "./events.ts";
import { type CoreNatEvents, CoreNatTraversal } from "./nat.ts";

export interface CorePeerInfo {
  peerID: string;
  topic: string;
  remoteAddress?: string;
  remotePort?: number;
  client?: boolean;
}

export interface CorePeerEnvelope<TPayload = unknown> {
  id: string;
  topic: string;
  from: string;
  to?: string;
  type: string;
  payload: TPayload;
  timestamp: number;
  encrypted: boolean;
}

export interface CoreP2PEvents extends CoreNatEvents {
  [key: string]: unknown;
  "peer.open": CorePeerInfo;
  "peer.close": CorePeerInfo;
  "peer.message": CorePeerEnvelope;
  "peer.error": { peerID?: string; error: Error };
}

export interface CoreP2PJoinOptions {
  server?: boolean;
  client?: boolean;
}

interface HyperswarmPeer {
  write(data: Uint8Array): boolean;
  end(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  remotePublicKey?: Uint8Array;
  remoteAddress?: string;
  remotePort?: number;
}

interface HyperswarmTopicHandle {
  flushed?(): Promise<void>;
  flush?(): Promise<void>;
  destroy?(): Promise<void>;
}

interface HyperswarmInstance {
  join(topic: Uint8Array, options?: CoreP2PJoinOptions): HyperswarmTopicHandle;
  on(event: string, handler: (...args: unknown[]) => void): void;
  destroy(): Promise<void>;
}

export class CoreP2PNetwork {
  private swarm: HyperswarmInstance | null = null;
  private readonly peers = new Map<string, HyperswarmPeer>();
  private readonly joinedTopics = new Map<string, HyperswarmTopicHandle>();
  private readonly nat: CoreNatTraversal;

  constructor(
    private readonly events: CoreEventBus<CoreP2PEvents> = new CoreEventBus<
      CoreP2PEvents
    >(),
    natTraversal?: CoreNatTraversal,
  ) {
    this.nat = natTraversal ??
      new CoreNatTraversal(
        this.events as unknown as CoreEventBus<CoreNatEvents>,
      );
  }

  bus(): CoreEventBus<CoreP2PEvents> {
    return this.events;
  }

  async start(): Promise<void> {
    if (this.swarm) {
      return;
    }

    const instance = await instantiateHyperswarm();
    this.swarm = instance;
    instance.on("connection", (...args: unknown[]) => {
      const [peer, details] = args as [
        HyperswarmPeer,
        { topics?: Uint8Array[]; client?: boolean } | undefined,
      ];
      void this.handleConnection(peer, details);
    });
    instance.on("error", (...args: unknown[]) => {
      const [error] = args as [Error];
      void this.events.emit("peer.error", { error });
    });
  }

  async join(topic: string, options: CoreP2PJoinOptions = {}): Promise<void> {
    await this.start();
    const swarm = this.requireSwarm();
    const topicKey = await hashTopic(topic);
    const discovery = swarm.join(topicKey, {
      client: options.client ?? true,
      server: options.server ?? true,
    });
    this.joinedTopics.set(topic, discovery);
    await discovery.flushed?.();
    await discovery.flush?.();
    await this.nat.markReady(this.joinedTopics.keys());
  }

  async leave(topic: string): Promise<void> {
    const discovery = this.joinedTopics.get(topic);
    this.joinedTopics.delete(topic);
    await discovery?.destroy?.();
    await this.nat.markReady(this.joinedTopics.keys());
  }

  async broadcast<TPayload>(
    topic: string,
    envelope: Omit<CorePeerEnvelope<TPayload>, "topic" | "timestamp">,
  ): Promise<void> {
    const message = serialiseEnvelope({
      ...envelope,
      topic,
      timestamp: Date.now(),
    });
    for (const peer of this.peers.values()) {
      peer.write(message);
    }
  }

  async send<TPayload>(
    peerID: string,
    envelope: Omit<CorePeerEnvelope<TPayload>, "timestamp">,
  ): Promise<void> {
    const peer = this.peers.get(peerID);
    if (!peer) {
      throw new Error(`unknown peer: ${peerID}`);
    }
    peer.write(serialiseEnvelope({ ...envelope, timestamp: Date.now() }));
  }

  async destroy(): Promise<void> {
    for (const topic of Array.from(this.joinedTopics.keys())) {
      await this.leave(topic);
    }
    for (const peer of this.peers.values()) {
      peer.end();
    }
    this.peers.clear();
    await this.swarm?.destroy();
    this.swarm = null;
  }

  private requireSwarm(): HyperswarmInstance {
    if (!this.swarm) {
      throw new Error("Hyperswarm is not started");
    }
    return this.swarm;
  }

  private async handleConnection(
    peer: HyperswarmPeer,
    details?: { topics?: Uint8Array[]; client?: boolean },
  ): Promise<void> {
    const topic = details?.topics?.[0]
      ? bytesToHex(details.topics[0])
      : "default";
    const peerID = bytesToHex(
      peer.remotePublicKey ?? crypto.getRandomValues(new Uint8Array(32)),
    );
    const peerInfo: CorePeerInfo = {
      peerID,
      topic,
      remoteAddress: peer.remoteAddress,
      remotePort: peer.remotePort,
      client: details?.client,
    };

    this.peers.set(peerID, peer);
    await this.events.emit("peer.open", peerInfo);
    await this.nat.observePeer({
      peerID,
      topic,
      remoteAddress: peer.remoteAddress,
      remotePort: peer.remotePort,
    });

    peer.on("data", (...args: unknown[]) => {
      const [chunk] = args as [Uint8Array];
      void this.handleMessage(chunk);
    });
    peer.on("close", () => {
      this.peers.delete(peerID);
      void this.events.emit("peer.close", peerInfo);
    });
    peer.on("error", (...args: unknown[]) => {
      const [error] = args as [Error];
      void this.events.emit("peer.error", { peerID, error });
    });
  }

  private async handleMessage(chunk: Uint8Array): Promise<void> {
    try {
      const envelope = parseEnvelope(chunk);
      await this.events.emit("peer.message", envelope);
    } catch (error) {
      await this.events.emit("peer.error", {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}

export async function createCoreP2PNetwork(): Promise<CoreP2PNetwork> {
  const network = new CoreP2PNetwork();
  await network.start();
  return network;
}

async function instantiateHyperswarm(): Promise<HyperswarmInstance> {
  const module = await loadHyperswarm() as {
    default?: new () => HyperswarmInstance;
  };
  const Hyperswarm = module.default;
  if (!Hyperswarm) {
    throw new Error("Hyperswarm default export is unavailable");
  }
  return new Hyperswarm();
}

function serialiseEnvelope<TPayload>(
  envelope: CorePeerEnvelope<TPayload>,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

function parseEnvelope(chunk: Uint8Array): CorePeerEnvelope {
  return JSON.parse(new TextDecoder().decode(chunk)) as CorePeerEnvelope;
}

async function hashTopic(topic: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(topic);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
