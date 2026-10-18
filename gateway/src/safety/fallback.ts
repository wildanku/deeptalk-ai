import type { L1Phrases, Protocol } from '../content/content.schemas';

/**
 * Engineering safety floor, used only when no approved (or, in development, draft) content
 * exists. It is deliberately minimal — clinical content comes from psikolog (03 §1) — but
 * having *no* crisis detection or *no* help information would be worse. Every use is logged.
 */
export const FALLBACK_L1: L1Phrases = {
  crisis: [
    'bunuh diri',
    'ingin mati',
    'mengakhiri hidup',
    'menyakiti diri',
    'suicide',
    'kill myself',
  ],
  elevated: [],
  normalization: { pengen: 'ingin', bundir: 'bunuh diri' },
};

export const FALLBACK_PROTOCOL: Protocol = {
  level: 'crisis',
  title: 'Bantuan darurat',
  message:
    'Keselamatanmu yang paling utama. Bila kamu dalam bahaya, segera hubungi layanan darurat 112 atau orang yang kamu percaya di dekatmu.',
  contacts: [
    {
      name: 'Layanan darurat',
      phone: '112',
      description: 'Panggilan darurat nasional.',
      verified: true,
    },
  ],
  offer_psikolog: true,
};
