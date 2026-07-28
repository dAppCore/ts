import { Module } from "@danet/core";
import {ObjectController} from "./object/object.controller.ts";
import { FileController } from "./file/file.controller.ts";
import {IniController} from "./ini/ini.controller.ts";
import {ObjectService} from "./object/object.service.ts";
import { ConfigFileService } from "./file/file.service.ts";
import { IniService } from "./ini/ini.service.ts";
@Module({
  controllers: [
    ObjectController,
    FileController,
    IniController
  ],
  injectables: [
    ObjectService,
    ConfigFileService,
    IniService
  ],
})
export class ConfigModule {}
