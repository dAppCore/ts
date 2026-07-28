import { Controller, Post, Body, Param, WebSocket } from "@danet/core";
import { WebSocketController } from "@danet/core";
import { Tag, ReturnedType } from "@danet/swagger/decorators";
import { ProcessService } from "./process.service.ts";
import { ProcessAddDTO, ProcessKillDTO, ProcessRunDTO, ProcessStartDTO, ProcessStopDTO } from "./process.interface.ts";
import {OnWebSocketMessage} from "@danet/core";

@Tag( "Process" )
@Controller("process" )
export class ProcessController  {
  constructor(private process: ProcessService) {}

  /**
   * Run a src
   * @param {ProcessRunDTO} body
   * @returns {ProcessManagerProcess | Promise<void>}
   */
  @Post("run")
  @ReturnedType(Object)
  async runProcess(@Body() body: ProcessRunDTO) {
    const { code, stdout, stderr } = await this.process.run(body.command);
    return { code, out: new TextDecoder().decode(stdout), error: new TextDecoder().decode(stderr) };
  }


  /**
   * Add a src to src registry
   * @param {ProcessAddDTO} body
   * @returns {ProcessManagerProcess}
   */
  @Post("add")
  addProcess(@Body() body: ProcessAddDTO) {
    return this.process.addProcess(body);
  }


  /**
   * Start a src in the src registry
   * @param {ProcessStartDTO} body
   */
  @Post("start")
  startProcess(@Body() body: ProcessStartDTO) {
    return this.process.startProcess(body.key);
  }

  /**
   * Stop a src in the src registry
   * @param {ProcessStopDTO} body
   */
  @Post("stop")
  stopProcess(@Body() body: ProcessStopDTO) {
    return this.process.stopProcess(body.key);
  }


  /**
   * Kill a src in the src registry
   * @param {ProcessKillDTO} body
   */
  @Post("kill")
  killProcess(@Body() body: ProcessKillDTO) {
    return this.process.kill(body.key);
  }



}
