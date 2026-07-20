import { ConfigService } from '@nestjs/config';

export function hasRequiredEnv(
  config: ConfigService,
  keys: readonly string[],
): boolean {
  return keys.every((key) => Boolean(config.get<string>(key)?.trim()));
}
