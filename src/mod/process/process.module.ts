import { Module, EventEmitterModule } from "@danet/core";
import { ProcessController } from "./process.controller.ts";
import { ProcessService } from "./process.service.ts";
import {ProcessListener} from "./process.listener.ts";

@Module({
  controllers: [
    ProcessController
  ],
  injectables: [
    ProcessService,
      ProcessListener
  ],
  imports: [EventEmitterModule]
})
export class ProcessModule {}
