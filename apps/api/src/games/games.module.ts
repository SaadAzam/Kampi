import { Module } from '@nestjs/common';
import { GamesController } from './games.controller.js';

@Module({
  controllers: [GamesController],
})
export class GamesModule {}
