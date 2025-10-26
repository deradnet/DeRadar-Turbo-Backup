import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import 'reflect-metadata';
import { existsSync } from 'fs';
import session from 'express-session';
import { generateOrInjectSecret } from './common/utils/generate-secret';
import { ApiEnabledGuard } from './common/guards/api-enabled.guard';
import { AuditExceptionFilter } from './common/filters/audit-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });

  const sessionSecret = generateOrInjectSecret();

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 86400000 },
    }),
  );

  app.useGlobalGuards(app.get(ApiEnabledGuard));
  app.useGlobalFilters(app.get(AuditExceptionFilter));
  app.use(cookieParser());
  app.use(json({ limit: '100mb' }));
  app.enableCors({ origin: '*' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties are present
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Enable type conversion
      },
    }),
  );

  const devViewsPath = join(__dirname, '..', 'src', 'views');
  const prodViewsPath = join(__dirname, 'views');
  const viewsPath = existsSync(prodViewsPath) ? prodViewsPath : devViewsPath;

  app.setBaseViewsDir(viewsPath);
  app.setViewEngine('ejs');

  // Serve static files from views directory
  app.useStaticAssets(viewsPath, {
    prefix: '/',
  });

  const config = new DocumentBuilder()
    .setTitle('DeRadar Turbo Backup Engine Documentation')
    .setDescription('DeRadar Turbo Backup Engine')
    .setVersion('1.0')
    .addTag('derad')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('doc', app, document, {
    swaggerOptions: {
      defaultModelsExpandDepth: -1, // Hide schemas section
    },
  });

  await app.listen(1937, '0.0.0.0');
}
bootstrap();
