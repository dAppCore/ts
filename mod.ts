import  * as path from "@std/path";
import { bootstrap } from "./src/bootstrap.ts";
import { buildSpec } from "./src/openapi.ts";
import { Command } from "@cliffy/command";
// cliffy v1 splits what was one module into submodule exports; the names are
// unchanged, only where they live.
import { HelpCommand } from "@cliffy/command/help";
import { CompletionsCommand } from "@cliffy/command/completions";
import { UpgradeCommand } from "@cliffy/command/upgrade";
import { GithubProvider } from "@cliffy/command/upgrade/provider/github";
import { DenoLandProvider } from "@cliffy/command/upgrade/provider/deno-land";
import denoConfig from "./deno.json" with { type: "json" };
import {ModIoFsLocalService} from "./src/mod/io/fs/local/service.ts";
const fs = new ModIoFsLocalService();
//const home = Deno.env.get('HOME') ? Deno.env.get('HOME') as string : Deno.cwd();

// if(path.join(home,'Lethean') !== Deno.cwd()){
//   Deno.chdir(path.join(home,'Lethean'))
// }
const cmds = await new Command()
    .name('lthn')
    .version(`v${denoConfig.version}`)
    .command(
        "openapi",
        "Creates OpenAPI definition json file.",
    )
    .action(async (_) => {
      // Disable console.log to avoid printing the entire spec to the console
      const origLog = console.log;
      console.log = function() {
        return;
      };
      Deno.writeTextFileSync("openapi.json", JSON.stringify(await buildSpec()));
      console.log = origLog;
      console.log(`openapi.json created in dir: ${Deno.cwd()}`);
      Deno.exit(0);
    })
    .command(
        "start",
        "Starts the server.",
    )
    .option("-u, --ui <path:string>", "UI HTML files.")
    .action(async (options) => {
      const application = await bootstrap();
      if(options['ui']){
          const staticAssetsPath = path.dirname(path.fromFileUrl(import.meta.url)) +'/'+ options['ui'];
          console.log('Static Assets Path:', staticAssetsPath)
          application.useStaticAssets(staticAssetsPath);
      }

      await application.listen(Number(Deno.env.get("PORT") || 36911));

    })
    .command("help", new HelpCommand().global())
    .command("completions", new CompletionsCommand())
    .command(
        "upgrade",
        new UpgradeCommand({
          main: "mod.ts",
          args: ["--allow-all", "--unstable"],
          provider: [
              new DenoLandProvider({ name: "lthn"}),
              new GithubProvider({ repository: "dappserver/server" }),
          ],
        }),
    )
    .parse(Deno.args);

if(Deno.args.length === 0){
    console.log('No command provided, use --help for more information')
  Deno.exit(0)
}
