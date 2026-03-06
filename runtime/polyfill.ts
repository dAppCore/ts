// Deno http2 + grpc-js polyfill — must be imported BEFORE @grpc/grpc-js.
//
// Two issues with Deno 2.x node compat:
// 1. http2.getDefaultSettings throws "Not implemented"
// 2. grpc-js's createConnection returns a socket that reports readyState="open"
//    but never emits "connect", causing http2 sessions to hang forever.
//    Fix: wrap createConnection to emit "connect" on next tick for open sockets.

import http2 from "node:http2";

// Fix 1: getDefaultSettings stub
(http2 as any).getDefaultSettings = () => ({
  headerTableSize: 4096,
  enablePush: true,
  initialWindowSize: 65535,
  maxFrameSize: 16384,
  maxConcurrentStreams: 0xffffffff,
  maxHeaderListSize: 65535,
  maxHeaderSize: 65535,
  enableConnectProtocol: false,
});

// Fix 2: grpc-js (transport.js line 536) passes an already-connected socket
// to http2.connect via createConnection. Deno's http2 never completes the
// HTTP/2 handshake because it expects a "connect" event from the socket,
// which already fired. Emitting "connect" again causes "Busy: Unix socket
// is currently in use" in Deno's internal http2.
//
// Workaround: track Unix socket paths via net.connect intercept, then in
// createConnection, return a FRESH socket. Keep the original socket alive
// (grpc-js has close listeners on it) but unused for data.
import net from "node:net";

const socketPathMap = new WeakMap<net.Socket, string>();
const origNetConnect = net.connect;
(net as any).connect = function (...args: any[]) {
  const sock = origNetConnect.apply(this, args as any);
  if (args[0] && typeof args[0] === "object" && args[0].path) {
    socketPathMap.set(sock, args[0].path);
  }
  return sock;
};

// Fix 3: Deno's http2 client never fires "remoteSettings" event, which
// grpc-js waits for before marking the transport as READY.
// Workaround: emit "remoteSettings" after "connect" with reasonable defaults.
const origConnect = http2.connect;
(http2 as any).connect = function (
  authority: any,
  options: any,
  ...rest: any[]
) {
  // For Unix sockets: replace pre-connected socket with fresh one
  if (options?.createConnection) {
    const origCC = options.createConnection;
    options = {
      ...options,
      createConnection(...ccArgs: any[]) {
        const origSock = origCC.apply(this, ccArgs);
        const unixPath = socketPathMap.get(origSock);
        if (
          unixPath &&
          !origSock.connecting &&
          origSock.readyState === "open"
        ) {
          const freshSock = net.connect({ path: unixPath });
          freshSock.on("close", () => origSock.destroy());
          return freshSock;
        }
        return origSock;
      },
    };
  }

  const session = origConnect.call(this, authority, options, ...rest);

  // Emit remoteSettings after connect — Deno's http2 doesn't emit it
  session.once("connect", () => {
    if (!session.destroyed && !session.closed) {
      const settings = {
        headerTableSize: 4096,
        enablePush: false,
        initialWindowSize: 65535,
        maxFrameSize: 16384,
        maxConcurrentStreams: 100,
        maxHeaderListSize: 8192,
        maxHeaderSize: 8192,
      };
      process.nextTick(() => session.emit("remoteSettings", settings));
    }
  });

  return session;
};
