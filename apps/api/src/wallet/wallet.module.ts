import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [WalletController],
})
export class WalletModule {}
