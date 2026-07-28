import { Module } from "@danet/core";
import { ObjectService } from "../config/object/object.service.ts";
import { LetheanDownloadService } from "../io/protocols/http/download/client.service.ts";
import { ModIoFsLocalService } from "../io/fs/local/service.ts";
import { AppManagerConfig } from "./pkg/config.service.ts";
import { AppManagerController } from "./manager/manager.controller.ts";
import { AppManager } from "./manager/manager.service.ts";
import { AppManagerInstaller } from "./pkg/installer.service.ts";

@Module({
  controllers: [
    AppManagerController
  ],
  injectables: [
    ObjectService,
    LetheanDownloadService,
    ModIoFsLocalService,
    AppManagerConfig,
    AppManager,
    AppManagerInstaller
  ],
})
export class AppsModule {}
