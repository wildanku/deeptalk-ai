import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { DATA_KEY_PROVIDER, type DataKeyProvider } from './crypto/key-provider';
import { KmsKeyProvider } from './crypto/kms-key-provider';
import { LocalKeyProvider } from './crypto/local-key-provider';
import { MessageCipher } from './crypto/message-cipher.service';
import { MessagesService } from './messages.service';

/** Fails closed: without a key, every encrypt/decrypt rejects and no content is stored. */
class UnconfiguredKeyProvider implements DataKeyProvider {
  current(): Promise<never> {
    return Promise.reject(new Error('Message encryption is not configured'));
  }
  unwrap(): Promise<never> {
    return this.current();
  }
}

/** KMS-encrypted message storage, history, and idempotency (02 §6.4, §9.1). */
@Module({
  providers: [
    {
      provide: DATA_KEY_PROVIDER,
      inject: [ConfigService],
      useFactory: async (
        config: ConfigService<Environment, true>,
      ): Promise<DataKeyProvider> => {
        const kmsKey = config.get('MESSAGE_KMS_KEY', { infer: true });
        const localKey = config.get('MESSAGE_LOCAL_KEY', { infer: true });
        if (kmsKey) {
          // Loaded lazily so local development never needs GCP libraries initialised.
          const { KeyManagementServiceClient } =
            await import('@google-cloud/kms');
          return new KmsKeyProvider(new KeyManagementServiceClient(), kmsKey);
        }
        if (localKey)
          return new LocalKeyProvider(Buffer.from(localKey, 'base64'));
        new Logger('MessagesModule').warn(
          'No MESSAGE_KMS_KEY or MESSAGE_LOCAL_KEY: messages cannot be stored',
        );
        return new UnconfiguredKeyProvider();
      },
    },
    MessageCipher,
    MessagesService,
  ],
  exports: [MessagesService, MessageCipher],
})
export class MessagesModule {}
