import { Module, EventEmitter, EventEmitterModule } from "@danet/core";
import { BaseController } from "./app.controller.ts";
import { IOModule } from "./mod/io/io.module.ts";
import { SystemController } from "./mod/system/system.controller.ts";
import { ConfigModule } from "./mod/config/config.module.ts";
import { CryptographyModule } from "./mod/cryptography/cryptography.module.ts";
import { AppsModule } from "./mod/apps/apps.module.ts";
import {ProcessModule} from "./mod/process/process.module.ts";
import {DockerModule} from "./mod/docker/docker.module.ts";

@Module({
  controllers: [BaseController, SystemController],
  injectables: [],
  imports: [
      EventEmitterModule,
    IOModule,
    ConfigModule,
    CryptographyModule,
    AppsModule,
    ProcessModule,
    DockerModule],
})
export class AppModule {}
