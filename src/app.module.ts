import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DebateModule } from './debate/debate.module';
import { HealthModule } from './health/health.module';

/**
 * Shadow Society — Mongo Atlas via MONGODB_URI.
 * Auth modules remain in the repo but are not imported (v0 public API).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    HealthModule,
    DebateModule,
  ],
})
export class AppModule {}
