import { z } from 'zod';

/**
 * Body schemas per content kind. Content is written by psikolog (dashboard, Phase 5) or seeded
 * from `content/`; a body that does not match is never used, whatever its status.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const topicId = z.string().regex(/^[a-z0-9_]{2,64}$/);

export const personaCardSchema = z.object({
  approach: text(500),
  focus_topics: z.array(topicId).min(1).max(10),
  tone: text(500),
  techniques: z.array(text(200)).max(10),
  questioning_style: text(500),
  always_say: z.array(text(300)).max(10).default([]),
  never_say: z.array(text(300)).max(10).default([]),
  opening: text(500),
  /** Case-study answers used as few-shot examples (02 §7.3: 5–8). */
  few_shots: z
    .array(z.object({ user: text(1000), assistant: text(2000) }))
    .max(8),
});
export type PersonaCard = z.infer<typeof personaCardSchema>;

export const protocolSchema = z.object({
  level: z.enum(['elevated', 'crisis']),
  title: text(120),
  message: text(2000),
  contacts: z
    .array(
      z.object({
        name: text(120),
        phone: z.string().trim().max(40).optional(),
        url: z.string().url().optional(),
        description: text(300),
        /** Whether the number has been checked (Q6). Unverified contacts are flagged in the UI. */
        verified: z.boolean().default(false),
      }),
    )
    .max(10),
  offer_psikolog: z.boolean().default(true),
});
export type Protocol = z.infer<typeof protocolSchema>;

export const l1PhrasesSchema = z.object({
  crisis: z.array(text(120)).min(1),
  elevated: z.array(text(120)).default([]),
  /** Slang/abbreviation → canonical word, applied before matching. */
  normalization: z.record(z.string(), z.string()).default({}),
});
export type L1Phrases = z.infer<typeof l1PhrasesSchema>;

export const knowledgeSchema = z.object({
  topic: topicId,
  title: text(200),
  content: text(20_000),
});
export type Knowledge = z.infer<typeof knowledgeSchema>;

export const routineItemSchema = z.object({
  topic: topicId,
  title: text(120),
  description: text(1000),
  kind: z.enum(['checklist', 'scale', 'note']),
  time_of_day: z
    .enum(['morning', 'afternoon', 'evening', 'any'])
    .default('any'),
  trigger: z.enum(['on_urge']).optional(),
  scale: z
    .object({ min: z.number().int(), max: z.number().int(), label: text(120) })
    .optional(),
  missed_day_message: text(300).optional(),
});
export type RoutineItem = z.infer<typeof routineItemSchema>;

/**
 * Consent text (Phase 4, 02 §9.2). `ref_id` is the consent type; the content version is the
 * `text_version` the user agrees to. A change that is not material keeps `min_accepted_version`,
 * so earlier agreements stay valid; a material change raises it and asks everyone again.
 */
export const consentTextSchema = z.object({
  /** Phase 9: `legacy_counseling` (users), `psikolog_addendum` (psikolog; Konsep §7.4). */
  type: z.enum([
    'service',
    'ai_training',
    'legacy_counseling',
    'psikolog_addendum',
  ]),
  title: text(200),
  /** Short points shown above the full text. */
  summary: z.array(text(300)).min(1).max(8),
  body: text(20_000),
  translations: z
    .object({
      en: z.object({
        title: text(200),
        summary: z.array(text(300)).min(1).max(8),
        body: text(20_000),
      }),
    })
    .optional(),
  min_accepted_version: z.number().int().positive(),
});
export type ConsentText = z.infer<typeof consentTextSchema>;

/** Topic → assessment products in the v3 catalog (Phase 5; `ref_id` = topic). */
export const assessmentMappingSchema = z.object({
  topic: topicId,
  assessment_product_ids: z.array(z.string().min(1).max(255)).min(1).max(5),
});
export type AssessmentMapping = z.infer<typeof assessmentMappingSchema>;

/** Questions a psikolog answers to describe their approach (Konsep §3.2). */
export const personaQuestionnaireSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]{2,64}$/),
        prompt: text(500),
        help: text(500).optional(),
        required: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(40),
});
export type PersonaQuestionnaire = z.infer<typeof personaQuestionnaireSchema>;

/**
 * A synthetic scenario every persona psikolog answers. `few_shot` answers become examples in
 * the Persona Card; `eval` answers are only used to evaluate it (02 §7.3).
 */
export const caseStudySchema = z.object({
  title: text(200),
  scenario: text(2000),
  topic: topicId.optional(),
  usage: z.enum(['few_shot', 'eval']),
  expected_risk_level: z
    .enum(['normal', 'elevated', 'crisis'])
    .default('normal'),
});
export type CaseStudy = z.infer<typeof caseStudySchema>;

/**
 * A topic as users see it (Phase 8; `ref_id` = topic ID). Adding a topic is content work: its
 * knowledge, routine items, and assessment mapping are separate kinds keyed by the same ID.
 */
export const topicSchema = z.object({
  label: text(60),
  description: text(300),
  /** False for topics that are pointed to a psikolog instead (Konsep §3.6). */
  routine_allowed: z.boolean().default(true),
});
export type Topic = z.infer<typeof topicSchema>;

const itemId = z.string().regex(/^[a-z0-9_]{1,64}$/);
const answerOptions = z
  .array(z.object({ value: z.number().int().min(0).max(10), label: text(80) }))
  .min(2)
  .max(11)
  .refine(
    (options) => new Set(options.map((o) => o.value)).size === options.length,
    'option values must be unique',
  );

/**
 * Daily check-in, periodic screening, or personality inventory (Phase 8). Choice-only on
 * purpose: there is no free text, so nothing here needs safety L1. Which instruments, their
 * wording, and their result bands are psikolog decisions; a result is never a diagnosis.
 */
export const instrumentSchema = z
  .object({
    purpose: z.enum(['checkin', 'screening', 'personality']),
    title: text(120),
    intro: text(1000),
    /** Shown with every result. */
    disclaimer: text(500),
    /** Days before the instrument is due again; 1 = daily. */
    interval_days: z.number().int().min(1).max(365),
    /** Default answer scale for every item without its own. */
    options: answerOptions,
    items: z
      .array(
        z.object({
          id: itemId,
          prompt: text(300),
          /** Short name for charts and history (check-in). */
          short_label: text(40).optional(),
          dimension: itemId.optional(),
          reverse: z.boolean().default(false),
          options: answerOptions.optional(),
          /**
           * An answer at or above this value shows the protocol and records a safety event,
           * whatever the total score (e.g. a question about thoughts of self-harm).
           */
          safety: z
            .object({
              min_value: z.number().int().min(0).max(10),
              level: z.enum(['elevated', 'crisis']),
            })
            .optional(),
        }),
      )
      .min(1)
      .max(60),
    scoring: z.object({
      method: z.enum(['sum', 'mean']),
      /** Per-dimension results (personality). Empty: a single total. */
      dimensions: z
        .array(
          z.object({
            id: itemId,
            label: text(80),
            description: text(500),
          }),
        )
        .max(10)
        .default([]),
      /** Result bands on the total; first match wins. */
      bands: z
        .array(
          z.object({
            min: z.number(),
            max: z.number(),
            label: text(80),
            description: text(500),
            suggest: z.enum(['none', 'assessment', 'psikolog']).default('none'),
          }),
        )
        .max(8)
        .default([]),
    }),
    translations: z
      .object({
        en: z.object({
          title: text(120),
          intro: text(1000),
          disclaimer: text(500),
          options: answerOptions,
          items: z
            .array(
              z.object({
                id: itemId,
                prompt: text(300),
                short_label: text(40).optional(),
                options: answerOptions.optional(),
              }),
            )
            .min(1)
            .max(60),
          scoring: z.object({
            dimensions: z
              .array(
                z.object({
                  id: itemId,
                  label: text(80),
                  description: text(500),
                }),
              )
              .max(10),
            bands: z
              .array(
                z.object({
                  min: z.number(),
                  max: z.number(),
                  label: text(80),
                  description: text(500),
                }),
              )
              .max(8),
          }),
        }),
      })
      .optional(),
    /** Topic whose assessment mapping a `suggest: assessment` band points to. */
    topic: topicId.optional(),
  })
  .superRefine((instrument, ctx) => {
    const ids = new Set<string>();
    const dimensions = new Set(instrument.scoring.dimensions.map((d) => d.id));
    instrument.items.forEach((item, index) => {
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: 'duplicate item id',
        });
      }
      ids.add(item.id);
      if (dimensions.size > 0 && !dimensions.has(item.dimension ?? '')) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'dimension'],
          message: 'item must name one of scoring.dimensions',
        });
      }
    });
  });
export type Instrument = z.infer<typeof instrumentSchema>;

export const CONTENT_SCHEMAS = {
  persona_card: personaCardSchema,
  protocol: protocolSchema,
  l1_phrases: l1PhrasesSchema,
  knowledge: knowledgeSchema,
  routine_item: routineItemSchema,
  consent_text: consentTextSchema,
  assessment_mapping: assessmentMappingSchema,
  persona_questionnaire: personaQuestionnaireSchema,
  case_study: caseStudySchema,
  topic: topicSchema,
  instrument: instrumentSchema,
} as const;

export type ContentKind = keyof typeof CONTENT_SCHEMAS;
export type ContentBody<K extends ContentKind> = z.infer<
  (typeof CONTENT_SCHEMAS)[K]
>;
