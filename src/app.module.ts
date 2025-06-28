import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from './common/utils/app.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { FlightDataModule } from './flight-data/flight-data.module';
import { ArchiveModule } from './archive/archive.module';
import { SystemService } from './system.service';
import { ArchiveRecord } from './archive/entities/archive-record.entity';
import { AuthModule } from './auth/auth.module';
import { ApiEnabledGuard } from './common/guards/api-enabled.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: config.get<string>('database.path'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([ArchiveRecord]),
    HttpModule,
    ScheduleModule.forRoot(),
    ArchiveModule,
    FlightDataModule,
    FlightDataModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [ApiEnabledGuard, AppService, SystemService],
})
export class AppModule {}
