import type { AgentClient } from '../agent-client/agent-client.service';
import type { ContentService } from '../content/content.service';
import type { PrismaService } from '../database/prisma.service';
import type { EvalRunsService } from './eval-runs.service';
import { personaStage, type PersonaStatusInput } from './persona-status';
import { PersonaWorkspaceService } from './persona-workspace.service';

const base: PersonaStatusInput = {
  questionnaireAvailable: true,
  workspace: null,
  fewShotAnswered: 0,
  versions: 0,
  persona: null,
};

describe('personaStage', () => {
  it.each<[string, Partial<PersonaStatusInput>, string]>([
    [
      'no questionnaire content',
      { questionnaireAvailable: false },
      'unavailable',
    ],
    ['never opened', {}, 'not_started'],
    [
      'opened but empty',
      { workspace: { displayName: null, answered: 0, required: 7 } },
      'not_started',
    ],
    [
      'partly answered',
      { workspace: { displayName: 'Reflektif', answered: 3, required: 7 } },
      'questionnaire',
    ],
    [
      'answers without a display name',
      { workspace: { displayName: null, answered: 7, required: 7 } },
      'questionnaire',
    ],
    [
      'questionnaire done, no example case',
      { workspace: { displayName: 'R', answered: 7, required: 7 } },
      'cases',
    ],
    [
      'ready to draft',
      {
        workspace: { displayName: 'R', answered: 7, required: 7 },
        fewShotAnswered: 1,
      },
      'draft',
    ],
    [
      'draft exists, not approved',
      {
        workspace: { displayName: 'R', answered: 7, required: 7 },
        versions: 1,
        persona: { status: 'disabled', activeVersion: null },
      },
      'review',
    ],
    [
      'approved and active',
      { versions: 2, persona: { status: 'active', activeVersion: 2 } },
      'active',
    ],
    [
      'approved, then disabled',
      { versions: 2, persona: { status: 'disabled', activeVersion: 2 } },
      'disabled',
    ],
  ])('%s → %s', (_name, input, stage) => {
    expect(personaStage({ ...base, ...input })).toBe(stage);
  });
});

describe('PersonaWorkspaceService.status', () => {
  const prisma = {
    ai_persona_workspaces: { findUnique: jest.fn(), upsert: jest.fn() },
    ai_eval_cases: { count: jest.fn() },
    ai_content_versions: { count: jest.fn() },
    ai_personas: { findUnique: jest.fn() },
  };
  const content = {
    active: jest.fn(() =>
      Promise.resolve({
        refId: 'default',
        version: 1,
        status: 'draft',
        body: {
          questions: [
            { id: 'approach', prompt: 'A', required: true },
            { id: 'tone', prompt: 'B', required: true },
            { id: 'never_say', prompt: 'C', required: false },
          ],
        },
      }),
    ),
  };
  const service = new PersonaWorkspaceService(
    prisma as unknown as PrismaService,
    content as unknown as ContentService,
    {} as AgentClient,
    {} as EvalRunsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ai_content_versions.count.mockResolvedValue(0);
    prisma.ai_personas.findUnique.mockResolvedValue(null);
    prisma.ai_eval_cases.count.mockResolvedValue(0);
  });

  it('never creates a workspace for a psikolog who has not started', async () => {
    prisma.ai_persona_workspaces.findUnique.mockResolvedValue(null);
    const status = await service.status('PSY-1');
    expect(status).toEqual({
      stage: 'not_started',
      questionnaire: { answered: 0, required: 2 },
      display_name: null,
    });
    expect(prisma.ai_persona_workspaces.upsert).not.toHaveBeenCalled();
    expect(prisma.ai_eval_cases.count).not.toHaveBeenCalled();
  });

  it('counts answered required questions only', async () => {
    prisma.ai_persona_workspaces.findUnique.mockResolvedValue({
      psychologist_id: 'PSY-1',
      persona_id: 'ps-psy-1',
      display_name: 'Reflektif',
      answers: { approach: 'x', never_say: 'y', tone: '  ' },
    });
    const status = await service.status('PSY-1');
    expect(status.stage).toBe('questionnaire');
    expect(status.questionnaire).toEqual({ answered: 1, required: 2 });
  });
});
