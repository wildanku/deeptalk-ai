import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../database/prisma.service';
import type { ai_content_versions, Prisma } from '../generated/prisma/client';
import { CONTENT_SCHEMAS, type ContentKind } from './content.schemas';
import { ContentService } from './content.service';

/**
 * Kinds curated by clinical reviewers. `persona_card` is not here: each psikolog approves their
 * own persona after an evaluation (Phase 5, `evals/`).
 */
export const REVIEWABLE_KINDS = [
  'protocol',
  'l1_phrases',
  'routine_item',
  'knowledge',
  'assessment_mapping',
  'case_study',
  'persona_questionnaire',
  'consent_text',
  'topic',
  'instrument',
] as const satisfies readonly ContentKind[];
export type ReviewableKind = (typeof REVIEWABLE_KINDS)[number];

const REF_ID = /^[a-z0-9][a-z0-9_-]{1,127}$/;

/** Versions written by engineering (`content:seed`) are placeholders and can never be approved. */
export const isEngineeringSeed = (authorId: string | null): boolean =>
  authorId === null || authorId.startsWith('seed:');

export interface VersionView {
  version: number;
  status: string;
  body: Prisma.JsonValue;
  author_id: string | null;
  engineering_seed: boolean;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

/**
 * Clinical content workflow (03 Phase 5): draft → in_review → approved | rejected. A body is
 * never edited — a correction is a new version. The approver is never the author (four eyes),
 * and the previous approved version is retired in the same transaction.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
  ) {}

  async overview() {
    const rows = await this.prisma.ai_content_versions.findMany({
      where: { kind: { in: [...REVIEWABLE_KINDS] } },
      select: { kind: true, ref_id: true, version: true, status: true },
      orderBy: [{ kind: 'asc' }, { ref_id: 'asc' }, { version: 'asc' }],
    });
    const refs = new Map<
      string,
      {
        kind: string;
        ref_id: string;
        approved_version: number | null;
        latest_version: number;
        latest_status: string;
        in_review: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.kind}/${row.ref_id}`;
      const current = refs.get(key) ?? {
        kind: row.kind,
        ref_id: row.ref_id,
        approved_version: null,
        latest_version: 0,
        latest_status: row.status,
        in_review: 0,
      };
      if (row.status === 'approved') current.approved_version = row.version;
      if (row.status === 'in_review') current.in_review += 1;
      if (row.version >= current.latest_version) {
        current.latest_version = row.version;
        current.latest_status = row.status;
      }
      refs.set(key, current);
    }
    return { kinds: REVIEWABLE_KINDS, items: [...refs.values()] };
  }

  async versions(kind: string, refId: string): Promise<VersionView[]> {
    const rows = await this.prisma.ai_content_versions.findMany({
      where: { kind: reviewable(kind), ref_id: refId },
      orderBy: { version: 'desc' },
    });
    return rows.map(view);
  }

  async create(
    kind: string,
    refId: string,
    body: unknown,
    authorId: string,
  ): Promise<VersionView> {
    const k = reviewable(kind);
    if (!REF_ID.test(refId))
      throw new BadRequestException('ref_id tidak valid');
    const parsed = CONTENT_SCHEMAS[k].safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'CONTENT_INVALID',
        message: 'Isi konten tidak sesuai format',
        issues: parsed.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const latest = await this.prisma.ai_content_versions.findFirst({
      where: { kind: k, ref_id: refId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    assertConsistent(k, refId, version, parsed.data);
    const row = await this.prisma.ai_content_versions.create({
      data: {
        id: uuidv7(),
        kind: k,
        ref_id: refId,
        version,
        body: parsed.data,
        status: 'draft',
        author_id: authorId,
      },
    });
    return view(row);
  }

  async submit(kind: string, refId: string, version: number, by: string) {
    const row = await this.find(kind, refId, version);
    if (row.author_id !== by)
      throw new ForbiddenException(
        'Hanya penulis yang bisa mengajukan versi ini',
      );
    return this.transition(row, 'draft', {
      status: 'in_review',
      submitted_at: new Date(),
    });
  }

  async approve(kind: string, refId: string, version: number, by: string) {
    const row = await this.find(kind, refId, version);
    if (isEngineeringSeed(row.author_id)) {
      throw new ForbiddenException({
        code: 'ENGINEERING_SEED',
        message:
          'Versi DRAFT dari engineering tidak bisa disetujui. Buat versi baru dengan isi dari psikolog.',
      });
    }
    if (row.author_id === by) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL',
        message: 'Versi ini harus disetujui reviewer lain, bukan penulisnya',
      });
    }
    const now = new Date();
    const approved = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ai_content_versions.updateMany({
        where: { id: row.id, status: 'in_review' },
        data: {
          status: 'approved',
          approved_by: by,
          approved_at: now,
          reviewed_by: by,
          reviewed_at: now,
        },
      });
      if (count === 0)
        throw new ConflictException('Versi ini tidak sedang ditinjau');
      await tx.ai_content_versions.updateMany({
        where: {
          kind: row.kind,
          ref_id: row.ref_id,
          status: 'approved',
          NOT: { id: row.id },
        },
        data: { status: 'retired' },
      });
      return tx.ai_content_versions.findUniqueOrThrow({
        where: { id: row.id },
      });
    });
    this.content.invalidate();
    return view(approved);
  }

  async reject(
    kind: string,
    refId: string,
    version: number,
    by: string,
    notes: string,
  ) {
    const row = await this.find(kind, refId, version);
    return this.transition(row, 'in_review', {
      status: 'rejected',
      reviewed_by: by,
      reviewed_at: new Date(),
      review_notes: notes,
    });
  }

  private async find(
    kind: string,
    refId: string,
    version: number,
  ): Promise<ai_content_versions> {
    const row = await this.prisma.ai_content_versions.findUnique({
      where: {
        kind_ref_id_version: { kind: reviewable(kind), ref_id: refId, version },
      },
    });
    if (!row) throw new NotFoundException('Versi konten tidak ditemukan');
    return row;
  }

  private async transition(
    row: ai_content_versions,
    from: 'draft' | 'in_review',
    data: Prisma.ai_content_versionsUpdateManyMutationInput,
  ): Promise<VersionView> {
    const { count } = await this.prisma.ai_content_versions.updateMany({
      where: { id: row.id, status: from },
      data,
    });
    if (count === 0)
      throw new ConflictException(`Versi ini tidak berstatus ${from}`);
    return view(
      await this.prisma.ai_content_versions.findUniqueOrThrow({
        where: { id: row.id },
      }),
    );
  }
}

function reviewable(kind: string): ReviewableKind {
  if (!(REVIEWABLE_KINDS as readonly string[]).includes(kind))
    throw new NotFoundException('Jenis konten tidak dikenal');
  return kind as ReviewableKind;
}

/** Cross-field rules a schema alone cannot express. */
function assertConsistent(
  kind: ReviewableKind,
  refId: string,
  version: number,
  body: unknown,
): void {
  const b = body as Record<string, unknown>;
  if (kind === 'consent_text') {
    if (b.type !== refId)
      throw new BadRequestException('type harus sama dengan ref_id');
    if (Number(b.min_accepted_version) > version)
      throw new BadRequestException(
        `min_accepted_version tidak boleh melebihi versi baru (${version})`,
      );
  }
  if (kind === 'assessment_mapping' && b.topic !== refId)
    throw new BadRequestException('topic harus sama dengan ref_id');
}

function view(row: ai_content_versions): VersionView {
  return {
    version: row.version,
    status: row.status,
    body: row.body,
    author_id: row.author_id,
    engineering_seed: isEngineeringSeed(row.author_id),
    submitted_at: row.submitted_at?.toISOString() ?? null,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at?.toISOString() ?? null,
    review_notes: row.review_notes,
    approved_by: row.approved_by,
    approved_at: row.approved_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}
