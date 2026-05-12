import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api', {
    exclude: [
      '',
      { path: 'mcp', method: RequestMethod.ALL },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const publicDir = join(process.cwd(), 'public');
  app.useStaticAssets(publicDir, { fallthrough: true });

  const port = Number(process.env.PORT ?? 5000);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);

  const logger = new (await import('@nestjs/common')).Logger('Bootstrap');
  logger.log(`WBS Web API listening on http://${host}:${port}`);
  logger.log(`Static assets served from: ${publicDir}`);
  logger.log(`DB_PATH: ${process.env.DB_PATH ?? '(default: ./data/wbs.db)'}`);
  logger.log(`MCP endpoint: http://${host}:${port}/mcp (Bearer auth required)`);
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap WBS Web API:', err);
  process.exit(1);
});
