import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

/** Psikolog recommendations from the v3 directory + active personas (02 §6.2, §7.4). */
@Module({
  imports: [MessagesModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
