import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AiAuthGuard, AiRoles } from '../auth/ai-auth.guard';
import { personaView, type PersonaView } from './persona-view';
import { SafetyService } from '../safety/safety.service';
import { ContentService } from './content.service';

@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly safety: SafetyService,
  ) {}

  /** Persona picker (Konsep §3.1). */
  @Get('personas')
  @UseGuards(AiAuthGuard)
  @AiRoles('user')
  async personas(): Promise<PersonaView[]> {
    return (await this.content.activePersonas()).map(personaView);
  }

  /**
   * Emergency help — public, no login, no consent (Konsep §3.3). The web help page renders
   * it; the app refreshes its offline copy from it.
   */
  @Get('help')
  @Header('Cache-Control', 'public, max-age=300')
  async help() {
    const [crisis, elevated] = await Promise.all([
      this.safety.protocol('crisis'),
      this.safety.protocol('elevated'),
    ]);
    return { crisis, elevated };
  }
}
