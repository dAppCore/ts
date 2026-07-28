import { Module } from "@danet/core";
import {DockerService} from "./docker.service.ts";
import {DockerController} from "./docker.controller.ts";

@Module({
  controllers: [
    DockerController
  ],
  injectables: [
    DockerService
  ],
  imports: []
})
export class DockerModule {}
