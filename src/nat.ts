import { CoreEventBus } from "./events.ts";

export interface CoreNatPeerState {
  peerID: string;
  topic: string;
  remoteAddress?: string;
  remotePort?: number;
  direct: boolean;
  strategy: "hyperswarm";
  timestamp: number;
}

export interface CoreNatStatus {
  ready: boolean;
  strategy: "hyperswarm";
  topics: string[];
  timestamp: number;
}

export interface CoreNatEvents {
  [key: string]: unknown;
  "nat.ready": CoreNatStatus;
  "nat.peer": CoreNatPeerState;
}

export class CoreNatTraversal {
  private readonly topics = new Set<string>();
  private ready = false;

  constructor(
    private readonly events: CoreEventBus<CoreNatEvents> = new CoreEventBus<
      CoreNatEvents
    >(),
  ) {}

  bus(): CoreEventBus<CoreNatEvents> {
    return this.events;
  }

  async markReady(topics: Iterable<string>): Promise<void> {
    this.ready = true;
    this.topics.clear();
    for (const topic of topics) {
      this.topics.add(topic);
    }
    await this.events.emit("nat.ready", this.snapshot());
  }

  async observePeer(input: {
    peerID: string;
    topic: string;
    remoteAddress?: string;
    remotePort?: number;
  }): Promise<void> {
    await this.events.emit("nat.peer", {
      peerID: input.peerID,
      topic: input.topic,
      remoteAddress: input.remoteAddress,
      remotePort: input.remotePort,
      direct: Boolean(input.remoteAddress),
      strategy: "hyperswarm",
      timestamp: Date.now(),
    });
  }

  snapshot(): CoreNatStatus {
    return {
      ready: this.ready,
      strategy: "hyperswarm",
      topics: Array.from(this.topics),
      timestamp: Date.now(),
    };
  }
}
