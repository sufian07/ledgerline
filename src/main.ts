import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApp } from "./configure-app.js";

const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true }));
await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
