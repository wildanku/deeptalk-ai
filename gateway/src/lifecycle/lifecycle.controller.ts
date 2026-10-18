import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import {
  InternalCaller,
  InternalTokenGuard,
} from '../auth/internal-token.guard';
import { LifecycleService } from './lifecycle.service';

class AccountEventDto {
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{1,255}$/)
  event_id: string;
}

class MergeEventDto extends AccountEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  from: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  to: string;
}

/** v3 → gateway account webhooks (02 §9.3). Idempotent per `event_id`. */
@Controller('internal/users')
@UseGuards(InternalTokenGuard)
@InternalCaller('v3')
export class LifecycleInternalController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Post('merge')
  @HttpCode(200)
  async merge(@Body() body: MergeEventDto) {
    return {
      result: await this.lifecycle.mergeUsers(
        body.from,
        body.to,
        body.event_id,
      ),
    };
  }

  @Post(':userId/delete')
  @HttpCode(200)
  async delete(@Param('userId') userId: string, @Body() body: AccountEventDto) {
    return { result: await this.lifecycle.deleteUser(userId, body.event_id) };
  }
}

@Controller('me')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class HistoryController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Delete('history')
  @HttpCode(204)
  async deleteHistory(
    @CurrentPrincipal() principal: AiPrincipal,
  ): Promise<void> {
    await this.lifecycle.deleteHistory(principal.sub);
  }
}
