import { EventEmitter, OnWebSocketMessage, WebSocket, WebSocketController } from "@danet/core";

/**
 * Realtime channel between the client and the daemons it is watching.
 *
 * This replaces a pair of hand-rolled servers: a standalone WebSocket on 36909
 * and a ZeroMQ-over-WebSocket broker on 36910, wired together so daemon output
 * published to the broker was relayed out to the browser. Danet serves
 * websockets on the application's own port and ships an EventEmitter, so both
 * listeners, both of their dependencies — deno.land/x/websocket and jszmq —
 * and the two extra ports all go away.
 *
 * jszmq mattered beyond tidiness: it imports from cdn.skypack.dev, which no
 * longer resolves, so nothing in the repository could be type-checked or have
 * a dependency added while it remained in the graph.
 *
 * The wire protocol CHANGES. Danet's websocket router parses every frame as
 * JSON and dispatches on its topic, where the old server read a raw
 * colon-delimited string:
 *
 *   before   "daemon:lethean"           after   {"topic":"daemon","data":"lethean"}
 *   before   "cmd:lethean:status"       after   {"topic":"cmd","data":{"daemon":"lethean","command":"status"}}
 *
 * Clients of the old 36909 socket need updating. That is the cost of using the
 * framework's router instead of parsing frames by hand.
 */
@WebSocketController("/ws")
export class CoreWebSocketController {
  constructor(private readonly emitter: EventEmitter) {}

  /**
   * Subscribe the socket to a daemon's stdout.
   *
   * In-process rather than a subscription to a local broker socket: publisher
   * and subscriber were always in the same runtime, so the hop through ZeroMQ
   * bought two ports and nothing else.
   */
  @OnWebSocketMessage("daemon")
  daemon(socket: WebSocket, daemon: string) {
    this.emitter.subscribe(`daemon.${daemon}`, (payload: string) => {
      // base64 because daemon output is arbitrary bytes, not necessarily
      // valid UTF-8 — as it was before.
      socket.send(JSON.stringify([daemon, btoa(payload)]));
    });
  }

  /**
   * Write a line to a daemon's stdin.
   *
   * Published, not written: the stdin consumer in processManagerProcess is
   * commented out, so this channel has no subscriber today — exactly as it had
   * none when it was a ZeroMQ topic. Emitting keeps the seam for whoever
   * revives that end, rather than inventing a write path ProcessService does
   * not have.
   */
  @OnWebSocketMessage("cmd")
  cmd(_socket: WebSocket, data: { daemon: string; command: string }) {
    this.emitter.emit(`daemon.${data.daemon}.stdin`, `${data.command}\n`);
  }
}
