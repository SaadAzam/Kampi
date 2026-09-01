import { Injectable } from '@nestjs/common';
import { ApiEnvSchema, getEconomyFromEnv, parseEnv } from '@kampi/contracts';

@Injectable()
export class AppConfigService {
  private readonly env = parseEnv(ApiEnvSchema);

  get nodeEnv() {
    return this.env.NODE_ENV;
  }

  get port() {
    return this.env.API_PORT;
  }

  get publicUrl() {
    return this.env.API_PUBLIC_URL;
  }

  get webOrigin() {
    return this.env.WEB_ORIGIN;
  }

  get adminOrigin() {
    return this.env.ADMIN_ORIGIN ?? this.env.WEB_ORIGIN;
  }

  get jwtSecret() {
    return this.env.JWT_SECRET;
  }

  get devGuestAuthEnabled() {
    if (this.nodeEnv === 'production' && this.env.DEV_GUEST_AUTH_ENABLED !== true) {
      return false;
    }
    return this.env.DEV_GUEST_AUTH_ENABLED;
  }

  get databaseUrl() {
    return this.env.DATABASE_URL;
  }

  get redisUrl() {
    return this.env.REDIS_URL;
  }

  get economy() {
    return getEconomyFromEnv(this.env);
  }
}
