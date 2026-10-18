import { DlpDeidentifier, LocalDeidentifier, mergeFindings } from './deid';

describe('LocalDeidentifier', () => {
  it('masks contact details and counts them without keeping values', async () => {
    const result = await new LocalDeidentifier().deidentify(
      'hubungi aku di rani.uji@contoh.id atau 0812-3456-7890, ig @rani_uji, NIK 3171234567890001',
    );
    expect(result.text).toBe(
      'hubungi aku di [EMAIL_ADDRESS] atau [PHONE_NUMBER], ig [SOCIAL_HANDLE], NIK [INDONESIA_NIK_NUMBER]',
    );
    expect(result.findings).toEqual({
      EMAIL_ADDRESS: 1,
      PHONE_NUMBER: 1,
      SOCIAL_HANDLE: 1,
      INDONESIA_NIK_NUMBER: 1,
    });
    expect(JSON.stringify(result.findings)).not.toContain('0812');
  });

  it('leaves ordinary text alone', async () => {
    const result = await new LocalDeidentifier().deidentify(
      'aku susah tidur 3 hari ini',
    );
    expect(result).toEqual({
      text: 'aku susah tidur 3 hari ini',
      findings: {},
    });
  });
});

describe('DlpDeidentifier', () => {
  const client = { deidentifyContent: jest.fn() };
  const dlp = new DlpDeidentifier(client, 'proj', 'asia-southeast2');

  it('calls DLP in the data region and sums findings per info type', async () => {
    client.deidentifyContent.mockResolvedValue([
      {
        item: { value: 'aku [PERSON_NAME] dari [LOCATION]' },
        overview: {
          transformationSummaries: [
            { infoType: { name: 'PERSON_NAME' }, results: [{ count: 2 }] },
            { infoType: { name: 'LOCATION' }, results: [{ count: '1' }] },
          ],
        },
      },
    ]);
    const result = await dlp.deidentify('aku Rani dari Bekasi');
    expect(client.deidentifyContent).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: 'projects/proj/locations/asia-southeast2',
        item: { value: 'aku Rani dari Bekasi' },
      }),
    );
    expect(result).toEqual({
      text: 'aku [PERSON_NAME] dari [LOCATION]',
      findings: { PERSON_NAME: 2, LOCATION: 1 },
    });
  });

  it('never falls back to the original text', async () => {
    client.deidentifyContent.mockResolvedValue([{ item: {} }]);
    await expect(dlp.deidentify('aku Rani')).rejects.toThrow();
  });
});

it('mergeFindings adds counts', () => {
  expect(mergeFindings({ A: 1 }, { A: 2, B: 1 })).toEqual({ A: 3, B: 1 });
});
