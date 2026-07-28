import { Module } from "@danet/core";
import { LetheanWebSocketController } from "./websocket.controller.ts";

/**
 * The realtime socket, kept in its own module so it can be registered after the
 * OpenAPI document is generated.
 *
 * @danet/swagger 2.3.2 walks every controller of every module it is given and
 * assumes each is an HTTP controller: it reads the class's `endpoint` metadata
 * and each method's HTTP verb. A websocket controller has neither — Danet
 * routes it on `websocket-endpoint` instead — so including it in the tree
 * swagger traverses kills document generation outright, first in trimSlash on
 * the undefined path and then on the undefined verb.
 *
 * There is no exclusion decorator to ask for. Bootstrapping this module after
 * SwaggerModule.createDocument is the way to have both: a complete API document
 * and a working socket.
 */
@Module({
  controllers: [LetheanWebSocketController],
})
export class WebSocketModule {}
