import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';

@Controller()
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('health/live')
  live() {
    return { status: 'ok', service: 'api' };
  }

  @Get('health/ready')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready', service: 'api' };
  }
}
