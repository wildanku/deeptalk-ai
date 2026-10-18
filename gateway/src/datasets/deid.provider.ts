import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { DEIDENTIFIER } from './datasets.service';
import { type Deidentifier, DlpDeidentifier, LocalDeidentifier } from './deid';

/** `DATASET_DEID=dlp` in production (enforced by env validation); `local` elsewhere. */
export const deidentifierProvider: Provider = {
  provide: DEIDENTIFIER,
  inject: [ConfigService],
  useFactory: async (
    config: ConfigService<Environment, true>,
  ): Promise<Deidentifier> => {
    if (config.get('DATASET_DEID', { infer: true }) !== 'dlp') {
      return new LocalDeidentifier();
    }
    // Loaded lazily so local development never initialises GCP libraries.
    const { DlpServiceClient } = await import('@google-cloud/dlp');
    const location = config.get('DLP_LOCATION', { infer: true });
    // Processing location comes from `parent` (projects/…/locations/<DLP_LOCATION>);
    // verify it stays in Jakarta before the DPIA is signed.
    return new DlpDeidentifier(
      new DlpServiceClient(),
      config.get('GOOGLE_CLOUD_PROJECT', { infer: true }) ?? '',
      location,
    );
  },
};
