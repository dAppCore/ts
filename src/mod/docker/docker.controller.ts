import {Controller, Get, Post, Body, Req, Param} from "@danet/core";
import {Tag, ReturnedType} from "@danet/swagger/decorators";
import { DockerService } from "./docker.service.ts";
import {Container, ContainerCreateResponse} from "./dto/container.create.ts";

@Tag("Docker")
@Controller("docker")
export class DockerController {
    constructor(private docker: DockerService) {

    }

    @Get('container/list')
    @ReturnedType(Object)
    async listContainers(): Promise<any[]>{
        return await this.docker.listContainers();
    }

    @Post('container/create/:id')
    @ReturnedType(ContainerCreateResponse)
    async createContainer(@Param('id') name: string, @Body() payload: Container): Promise<ContainerCreateResponse>{
        return await this.docker.createContainer(name, payload);

    }

    @Get('container/start/:id')
    @ReturnedType(Object)
    async startContainer(@Param('id') id: string): Promise<any>{
        return await this.docker.startContainer(id);
    }

    @Get('container/stop/:id')
    @ReturnedType(Object)
    async stopContainer(@Param('id') id: string): Promise<any>{
        return await this.docker.stopContainer(id);
    }

    @Get('container/kill/:id')
    @ReturnedType(Object)
    async killContainer(@Param('id') id: string): Promise<any>{
        return await this.docker.killContainer(id);
    }

    @Get('container/remove/:id')
    @ReturnedType(Object)
    async removeContainer(@Param('id') id: string): Promise<any>{
        return await this.docker.removeContainer(id);
    }

    @Get('container/inspect/:id')
    @ReturnedType(Object)
    async inspectContainer(@Param('id') id: string): Promise<any>{
        return await this.docker.inspectContainer(id);
    }

    @Get('image/list')
    @ReturnedType(Object)
    async listImages(): Promise<any[]>{
        return await this.docker.listImages();
    }

    @Post('image/pull')
    @ReturnedType(Object)
    async pullImage(@Body() payload: { image: string }): Promise<any>{
        return await this.docker.pullImage(payload.image);
    }


}
