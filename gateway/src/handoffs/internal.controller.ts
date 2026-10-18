import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  InternalCaller,
  InternalTokenGuard,
} from '../auth/internal-token.guard';
import { RemindersService } from '../routines/reminders.service';
import { HandoffsService } from './handoffs.service';

class PsikologQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  psikolog_id: string;
}

/** Service-to-service endpoints; never reachable with a user or psikolog token. */
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(
    private readonly handoffs: HandoffsService,
    private readonly reminders: RemindersService,
  ) {}

  /** v3 `GET /v2/psikolog/book/:bookingId/ai-summary` forwards here after its own checks. */
  @Get('handoffs/by-booking/:bookingId')
  @InternalCaller('v3')
  summary(
    @Param('bookingId') bookingId: string,
    @Query() query: PsikologQueryDto,
  ) {
    return this.handoffs.readForPsikolog(bookingId, query.psikolog_id);
  }

  /** Cloud Scheduler, every 5 minutes. */
  @Post('scheduler/routine-reminders')
  @InternalCaller('scheduler')
  @HttpCode(200)
  async routineReminders() {
    return { queued: await this.reminders.dispatchDue() };
  }
}
