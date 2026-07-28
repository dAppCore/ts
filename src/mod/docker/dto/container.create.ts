import { type ContainerCreate } from "https://deno.land/x/docker_deno/mod.ts";
import {ApiProperty} from "@danet/swagger/decorators";
export interface ContainerCreateRequest {
    name: string;
    container: ContainerCreate;
}

export class ContainerCreateResponse {
    Id: string;
    Warnings: string;
}

export class Container {
    @ApiProperty()
    Image: string;
    @ApiProperty()
    Cmd: string[];
    @ApiProperty()
    AttachStdin: boolean;
    @ApiProperty()
    AttachStdout: boolean;
    @ApiProperty()
    AttachStderr: boolean;
    @ApiProperty()
    Tty: boolean;
    @ApiProperty()
    OpenStdin: boolean;
    @ApiProperty()
    StdinOnce: boolean;
    @ApiProperty()
    Env: string[];
    @ApiProperty()
    HostConfig: any;
    @ApiProperty()
    NetworkingConfig: any;
}

export class ContainerCreateDTO implements ContainerCreateRequest {
    @ApiProperty()
    name: string;
    @ApiProperty()
    container: Container;

}