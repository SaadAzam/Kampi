import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';

function originFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const config = app.get(AppConfigService);
  const corsOrigins = [
    ...new Set(
      [
        config.webOrigin,
        config.adminOrigin,
        originFromUrl(process.env.GAME_RPS_PUBLIC_URL),
        originFromUrl(process.env.GAME_PENALTY_PUBLIC_URL),
      ].filter((origin): origin is string => Boolean(origin)),
    ),
  ];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.use(CorrelationIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  if (config.nodeEnv !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('Kampi API')
      .setDescription('Kampi.fun platform API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.port);
  console.info(`API listening on ${config.publicUrl}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start API', error);
  process.exit(1);
});
