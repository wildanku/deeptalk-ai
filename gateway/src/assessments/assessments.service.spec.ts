import type { ContentService } from '../content/content.service';
import type { V3Client } from '../v3-client/v3-client.service';
import { AssessmentsService } from './assessments.service';

describe('AssessmentsService.validate', () => {
  const content = { listActive: jest.fn() };
  const mapping = (topic: string, ids: string[]) => [
    {
      refId: topic,
      version: 1,
      status: 'approved',
      body: { topic, assessment_product_ids: ids },
    },
  ];
  const v3 = { assessment: jest.fn() };
  const service = new AssessmentsService(
    content as unknown as ContentService,
    v3 as unknown as V3Client,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects an assessment that is not mapped to the topic (fake ID)', async () => {
    content.listActive.mockResolvedValue(mapping('kecemasan', ['a1']));
    await expect(
      service.validate({
        assessment_id: 'fake',
        topic: 'kecemasan',
        reason: 'r',
      }),
    ).resolves.toBeNull();
    expect(v3.assessment).not.toHaveBeenCalled();
  });

  it('rejects a topic without an approved mapping', async () => {
    content.listActive.mockResolvedValue(mapping('tidur', ['a1']));
    await expect(
      service.validate({
        assessment_id: 'a1',
        topic: 'kecemasan',
        reason: 'r',
      }),
    ).resolves.toBeNull();
  });

  it('rejects a product that left the v3 catalog', async () => {
    content.listActive.mockResolvedValue(mapping('kecemasan', ['a1']));
    v3.assessment.mockResolvedValue(null);
    await expect(
      service.validate({
        assessment_id: 'a1',
        topic: 'kecemasan',
        reason: 'r',
      }),
    ).resolves.toBeNull();
  });

  it('builds the card from the catalog, not from the agent', async () => {
    content.listActive.mockResolvedValue(mapping('kecemasan', ['a1']));
    v3.assessment.mockResolvedValue({
      id: 'a1',
      name: 'Tes Kecemasan',
      is_free: true,
      description: null,
      category: null,
    });
    await expect(
      service.validate({
        assessment_id: 'a1',
        topic: 'kecemasan',
        reason: 'Kamu cerita sering cemas',
      }),
    ).resolves.toEqual({
      assessment_id: 'a1',
      title: 'Tes Kecemasan',
      reason: 'Kamu cerita sering cemas',
      is_free: true,
      topic: 'kecemasan',
    });
  });
});
