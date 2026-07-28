//import { path } from "../../deps.ts";
//import { assertEquals } from "../../deps-test.ts";
//import { DockerService } from "../../src/mod/docker/docker.service.ts";
//
//Deno.test("DockerService.listContainers", async () => {
//  try {
//
//    const docker = new DockerService();
//    const containers = await docker.listContainers();
//    assertEquals(containers[0].Id != undefined, true);
//  } catch (e) {
//
//  }
//});
//
//Deno.test("DockerService.createContainer", async () => {
//  try {
//    const docker = new DockerService();
//    const container = await docker.createContainer("CoreTest", { Image: "lthn/chain:latest" });
//    console.log(container);
//  } catch (e) {
//
//  }
//});
