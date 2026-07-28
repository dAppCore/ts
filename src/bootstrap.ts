import {AppModule} from './app.module.ts';
import {WebSocketModule} from './mod/io/protocols/websocket/websocket.module.ts';
import * as path from "@std/path";
import {DanetApplication, Logger} from "@danet/core";
import {SpecBuilder, SwaggerModule} from "@danet/swagger";
import { expandGlob } from "@std/fs/expand-glob";

export const bootstrap = async () => {
    const application = new DanetApplication();
    // LoggerMiddleware must be the first middleware
    // TimingMiddleware must be the second middleware
    // application.addGlobalMiddlewares(LoggerMiddleware,TimingMiddleware, CorsMiddleware, RequestIDMiddleware, JWTAuthMiddleware);
    application.enableCors()
    await application.init(AppModule)

    try {
        const logger = new Logger('dAppServer')
        const basePath = path.join(Deno.cwd(), 'apps')

        if (Deno.statSync(basePath).isDirectory) {
            logger.log(`Loading dApp's ${basePath}`)
            for await(const f of expandGlob(path.join(basePath, '**\/*.module.ts'))) {
                logger.log(`Checking: ${f.path}`)
                if (Deno.statSync(f.path).isFile) {
                    logger.log(`Found App: ${f.name}`)
                    try {
                        const module =  await import(f.path)
                        for(const key in module) {
                            await application.bootstrap(module[key])
                        }
                    } catch (e) {
                        console.log('Error: ', e);
                    }
                } else {
                    logger.warn(`Unable to load ${f.name}`)
                }
            }
        }
    } catch (e) {}
    // Swagger API Docs + JSON Definition
    const spec = new SpecBuilder()
        .setTitle('Lethean Server')
        .setDescription('Lethean dAppServer')
        .setVersion('3.1.1')
        .addServer('http://localhost:36911')
        .setContact('Lethean', 'https://lethean.io', 'hello@lt.hn')
        .setLicense('EUPL-1.2', 'https://eupl.eu/1.2/en/')
        .build();
    const document = await SwaggerModule.createDocument(application, spec);
    await SwaggerModule.setup('api', application, document);

    // After the document, deliberately. swagger walks every controller it is
    // given as an HTTP one, and a websocket controller has no path or verb for
    // it to read — see WebSocketModule.
    await application.bootstrap(WebSocketModule);

    return application;
}
