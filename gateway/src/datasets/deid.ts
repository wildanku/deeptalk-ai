import type { DlpServiceClient } from '@google-cloud/dlp';

export interface DeidResult {
  text: string;
  /** Count per info type that was masked — never the values. */
  findings: Record<string, number>;
}

/** Removes identifying details from one message before anything is stored (Konsep §7.4). */
export interface Deidentifier {
  readonly name: string;
  deidentify(text: string): Promise<DeidResult>;
}

/**
 * What Sensitive Data Protection looks for. Names and places are the main risk in counseling
 * text; the list is part of the DPIA and must be re-checked against the DLP info type catalog.
 */
export const DLP_INFO_TYPES = [
  'PERSON_NAME',
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'STREET_ADDRESS',
  'LOCATION',
  'DATE_OF_BIRTH',
  'INDONESIA_NIK_NUMBER',
  'CREDIT_CARD_NUMBER',
  'IP_ADDRESS',
  'URL',
] as const;

export const mergeFindings = (
  into: Record<string, number>,
  more: Record<string, number>,
): Record<string, number> => {
  for (const [key, count] of Object.entries(more)) {
    into[key] = (into[key] ?? 0) + count;
  }
  return into;
};

/** Sensitive Data Protection in the data's own region; values are replaced by `[INFO_TYPE]`. */
export class DlpDeidentifier implements Deidentifier {
  readonly name = 'dlp';

  constructor(
    private readonly client: Pick<DlpServiceClient, 'deidentifyContent'>,
    private readonly projectId: string,
    private readonly location: string,
  ) {}

  async deidentify(text: string): Promise<DeidResult> {
    const [response] = await this.client.deidentifyContent({
      parent: `projects/${this.projectId}/locations/${this.location}`,
      inspectConfig: {
        infoTypes: DLP_INFO_TYPES.map((name) => ({ name })),
        minLikelihood: 'POSSIBLE',
      },
      deidentifyConfig: {
        infoTypeTransformations: {
          transformations: [
            { primitiveTransformation: { replaceWithInfoTypeConfig: {} } },
          ],
        },
      },
      item: { value: text },
    });
    const findings: Record<string, number> = {};
    for (const summary of response.overview?.transformationSummaries ?? []) {
      const name = summary.infoType?.name;
      if (!name) continue;
      const count = (summary.results ?? []).reduce(
        (sum, result) => sum + Number(result.count ?? 0),
        0,
      );
      findings[name] = (findings[name] ?? 0) + count;
    }
    if (typeof response.item?.value !== 'string') {
      // Never fall back to the original text.
      throw new Error('DLP returned no de-identified value');
    }
    return { text: response.item.value, findings };
  }
}

const LOCAL_PATTERNS: [string, RegExp][] = [
  ['EMAIL_ADDRESS', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ['URL', /\bhttps?:\/\/\S+|\bwww\.\S+/gi],
  ['INDONESIA_NIK_NUMBER', /\b\d{16}\b/g],
  ['PHONE_NUMBER', /(?:\+62|\b62|\b0)8[\d\s-]{7,13}\d/g],
  ['SOCIAL_HANDLE', /(?<![\w.])@[A-Za-z0-9_.]{3,30}/g],
  ['NUMBER', /\b\d{6,}\b/g],
];

/**
 * Development stand-in: masks obvious contact details only. It does not find names, so it is
 * rejected in production (`DATASET_DEID=dlp` required) and only ever sees synthetic data.
 */
export class LocalDeidentifier implements Deidentifier {
  readonly name = 'local';

  deidentify(text: string): Promise<DeidResult> {
    const findings: Record<string, number> = {};
    let result = text;
    for (const [infoType, pattern] of LOCAL_PATTERNS) {
      result = result.replace(pattern, () => {
        findings[infoType] = (findings[infoType] ?? 0) + 1;
        return `[${infoType}]`;
      });
    }
    return Promise.resolve({ text: result, findings });
  }
}
