import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [StatsController],
})
export class StatsModule {}
