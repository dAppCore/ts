import {assertEquals} from "@std/assert";
import {ProcessService} from "../../src/mod/process/process.service.ts";

const process = new ProcessService();
Deno.test("ProcessService.start('ls')", async () => {
    const { code, stdout, stderr } = await process.run('ls', ['-l', '.'])
    assertEquals(code, 0);
    assertEquals(new TextDecoder().decode(stdout).includes("mod.ts"), true);
});

Deno.test("Process Persistence", async () => {
    assertEquals(process.list().includes("ls"), true);
    process.kill('ls')
    assertEquals(process.list().includes("ls"), false);
});
Deno.test("ProcessService.run('pwd')", async () => {
    const { code, stdout, stderr } = await process.run('pwd')
    assertEquals(code, 0);
    assertEquals(new TextDecoder().decode(stdout).includes("server"), true);
});
