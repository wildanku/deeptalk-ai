import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { RemindersService } from './reminders.service';
import { RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';

/** Routine library, proposals, user routines, logs, and reminders (02 §7.4, Phase 3). */
@Module({
  imports: [MessagesModule],
  controllers: [RoutinesController],
  providers: [RoutinesService, RemindersService],
  exports: [RoutinesService, RemindersService],
})
export class RoutinesModule {}
