import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

export type HealthCheckResult = {
  status: 'ok' | 'degraded';
  app: string;
  timestamp: string;
  database: { status: 'up' | 'down' | 'not_configured' };
  llm: { status: 'configured' | 'mock' };
};

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async check(): Promise<HealthCheckResult> {
    const mongoUri = this.config.get<string>('MONGODB_URI')?.trim();
    const hasLlm = Boolean(
      this.config.get<string>('DASHSCOPE_API_KEY')?.trim(),
    );
    const databaseStatus = mongoUri
      ? await this.checkDatabase()
      : 'not_configured';

    return {
      status: databaseStatus === 'up' || databaseStatus === 'not_configured' ? 'ok' : 'degraded',
      app: 'shadow-society-services',
      timestamp: new Date().toISOString(),
      database: { status: databaseStatus },
      llm: { status: hasLlm ? 'configured' : 'mock' },
    };
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    if (this.connection.readyState !== 1) {
      return 'down';
    }
    try {
      await this.connection.db?.admin().ping();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
