import {Injectable} from "@danet/core";
import Docker from "https://deno.land/x/docker_deno/mod.ts";
import { type ContainerCreate } from "https://deno.land/x/docker_deno/mod.ts";

@Injectable()
export class DockerService {
    /**
     * Turns on console.log with 1 or 0
     *
     * @type {number}
     * @private
     */
    private static debug = 0;
    private docker: Docker

    constructor() {
        this.docker = new Docker("/var/run/docker.sock");
    }

    /**
     * List all containers
     *
     * @returns {Promise<any>}
     */
    async listContainers(): Promise<any> {
        return await this.docker.containers.list({all: true});
    }

    /**
     * Create a container
     *
     * @returns {Promise<any>}
     * @param name
     * @param container
     */
    async createContainer(name: string, container: ContainerCreate): Promise<any> {
        return await this.docker.containers.create(name, container);
    }

    async startContainer(id: string): Promise<any> {
        return await this.docker.containers.start(id);
    }

    async stopContainer(id: string): Promise<any> {
        return await this.docker.containers.stop(id);
    }

    async removeContainer(id: string): Promise<any> {
        return await this.docker.containers.rm(id);
    }

    async killContainer(id: string): Promise<any> {
        return await this.docker.containers.kill(id, "SIGKILL");
    }

    async inspectContainer(id: string): Promise<any> {
        return await this.docker.containers.inspect(id);
    }

    async restartContainer(id: string): Promise<any> {
        return await this.docker.containers.restart(id);
    }

    async listImages(): Promise<any> {
        return await this.docker.images.list();
    }

    async pullImage(payload: string): Promise<any> {
        return await this.docker.images.pull(payload);
    }

}
