import { Module } from "@danet/core";
import { ModIoFsLocalService } from "./fs/local/service.ts";
import { ModIoFsLocalController } from "./fs/local/controller.ts";
import { DownloadClientController } from "./protocols/http/download/client.controller.ts";
import { CoreDownloadService } from "./protocols/http/download/client.service.ts";
import {ModIoFsS3Service} from "./fs/s3/service.ts";

@Module({
  imports: [

  ],
  controllers: [
    ModIoFsLocalController,
    DownloadClientController
  ],
  injectables: [
    ModIoFsLocalService,
    CoreDownloadService,
      ModIoFsS3Service
  ],
})
export class IOModule {}
