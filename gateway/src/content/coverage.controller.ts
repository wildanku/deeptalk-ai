import { Controller, Get, UseGuards } from '@nestjs/common';
import { AiAuthGuard, AiRoles } from '../auth/ai-auth.guard';
import { RequireStaffRole, StaffRoleGuard } from '../auth/staff-role.guard';
import { PrismaService } from '../database/prisma.service';
import { ContentService } from './content.service';
import { computeCoverage, type CoveragePersona } from './coverage';

const COVERAGE_KINDS = [
  'topic',
  'knowledge',
  'routine_item',
  'assessment_mapping',
  'persona_card',
] as const;

/** Topic labels for the persona picker and Teman AI screens (03 Phase 8). */
@Controller('topics')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class TopicsController {
  constructor(private readonly content: ContentService) {}

  @Get()
  async list() {
    const topics = await this.content.listActive('topic');
    return topics
      .map((topic) => ({
        id: topic.refId,
        label: topic.body.label,
        description: topic.body.description,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

/**
 * Content coverage per topic and persona progress (03 Phase 8): what is still missing before a
 * topic can be offered, and how many psikolog have a persona. Counts only.
 */
@Controller('review/coverage')
@UseGuards(AiAuthGuard, StaffRoleGuard)
@AiRoles('psikolog')
@RequireStaffRole('clinical_reviewer')
export class CoverageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async coverage() {
    const [rows, personas, workspaces] = await Promise.all([
      this.prisma.ai_content_versions.findMany({
        where: {
          kind: { in: [...COVERAGE_KINDS] },
          status: { in: ['approved', 'draft', 'in_review'] },
        },
        select: {
          kind: true,
          ref_id: true,
          version: true,
          status: true,
          body: true,
        },
      }),
      this.prisma.ai_personas.findMany({
        select: { id: true, status: true, active_version: true },
      }),
      this.prisma.ai_persona_workspaces.count(),
    ]);

    const cards = rows.filter((row) => row.kind === 'persona_card');
    const coveragePersonas: CoveragePersona[] = personas.map((persona) => {
      const versions = cards
        .filter((card) => card.ref_id === persona.id)
        .sort((a, b) => b.version - a.version);
      const pinned = versions.find(
        (card) =>
          card.version === persona.active_version && card.status === 'approved',
      );
      const newest = pinned ?? versions[0];
      const topics = (newest?.body as { focus_topics?: unknown } | undefined)
        ?.focus_topics;
      return {
        id: persona.id,
        status: persona.status,
        focus_topics: Array.isArray(topics)
          ? topics.filter((t): t is string => typeof t === 'string')
          : [],
        approved: Boolean(pinned),
      };
    });

    const active = coveragePersonas.filter((p) => p.status === 'active');
    return {
      personas: {
        workspaces,
        active_approved: active.filter((p) => p.approved).length,
        active_draft: active.filter((p) => !p.approved).length,
        disabled: coveragePersonas.length - active.length,
      },
      topics: computeCoverage(
        rows.filter((row) => row.kind !== 'persona_card'),
        coveragePersonas,
      ),
    };
  }
}
