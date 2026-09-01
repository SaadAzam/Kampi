import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [MatchesController],
})
export class MatchesModule {}
