import { Module } from '@nestjs/common';
import { PlayersController } from './players.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [PlayersController],
})
export class PlayersModule {}
