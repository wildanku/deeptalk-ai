import { Module } from '@nestjs/common';
import { ImpactController } from './impact.controller';
import { ImpactService } from './impact.service';

/** Impact indicators for staged rollout decisions and reporting (03 Phase 7). */
@Module({
  controllers: [ImpactController],
  providers: [ImpactService],
  exports: [ImpactService],
})
export class ImpactModule {}
