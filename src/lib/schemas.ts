import { z } from 'zod';

export const STATUSES = ['active', 'expired', 'suspended', 'revoked', 'inactive', 'pending', 'not_found', 'unknown'] as const;
export const OUTCOMES = ['verified', 'partially_verified', 'ambiguous', 'not_found', 'unsupported', 'temporarily_unavailable', 'failed'] as const;
export const CONFIDENCE = ['high', 'medium', 'low'] as const;
export const STAGES = ['finding_source', 'searching_registry', 'comparing_records', 'verifying_evidence'] as const;
export const RECORD_TYPES = ['medical_license', 'contractor_license', 'company_registration'] as const;

export type Status = (typeof STATUSES)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type Stage = (typeof STAGES)[number];
export type RecordType = (typeof RECORD_TYPES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EvidenceSchema = z.object({
  url: z.string().url(),
  excerpt: z.string().nullable(),
  fields: z.array(z.string()),
  fetched_at: z.string(),
  /** true only when the excerpt was found verbatim in an independently fetched copy of the source page */
  validated: z.boolean(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RecordSchema = z.object({
  type: z.enum(RECORD_TYPES),
  number: z.string().nullable(),
  status: z.enum(STATUSES),
  source_status: z.string().nullable(),
  issue_date: isoDate.nullable(),
  expiry_date: isoDate.nullable(),
  /** null = not available from the source; [] = source shows the section and it is empty */
  disciplinary_actions: z.array(z.string()).nullable(),
});
export type NormalizedRecord = z.infer<typeof RecordSchema>;

export const CandidateViewSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  license_number: z.string().nullable(),
  profession: z.string().nullable(),
  status_text: z.string().nullable(),
  location: z.string().nullable(),
  organization: z.string().nullable(),
  record_url: z.string().nullable(),
});
export type CandidateView = z.infer<typeof CandidateViewSchema>;

export const VerificationResultSchema = z.object({
  id: z.string(),
  state: z.enum(['queued', 'running', 'awaiting_selection', 'completed', 'failed']),
  stage: z.enum(STAGES).nullable(),
  subject: z.object({ type: z.enum(['person', 'business']), name: z.string() }),
  record: RecordSchema.nullable(),
  jurisdiction: z.object({ country: z.string(), region: z.string().nullable() }),
  verification: z.object({
    outcome: z.enum(OUTCOMES).nullable(),
    confidence: z.enum(CONFIDENCE).nullable(),
    confidence_reasons: z.array(z.string()),
    checked_at: z.string().nullable(),
    source_name: z.string().nullable(),
    source_url: z.string().nullable(),
    evidence: z.array(EvidenceSchema),
    limitations: z.array(z.string()),
    matched_name: z.string().nullable(),
  }),
  candidates: z.array(CandidateViewSchema),
  history: z.array(z.object({ at: z.string(), type: z.string(), message: z.string() })),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable(),
  monitoring: z.object({
    enabled: z.boolean(),
    monitor_id: z.string().nullable(),
    status: z.enum(['not_configured', 'creating', 'active', 'paused', 'failed']),
  }),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const CreateVerificationBody = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(200),
  subject_type: z.enum(['person', 'business']),
  record_type: z.enum(RECORD_TYPES),
  country: z.string().trim().length(2).transform((s) => s.toUpperCase()),
  region: z.string().trim().max(10).optional().nullable().transform((s) => (s ? s.toUpperCase() : null)),
  license_number: z.string().trim().max(60).optional().nullable().transform((s) => s || null),
  source_url: z.string().trim().max(500).optional().nullable().transform((s) => s || null),
});
export type CreateVerificationInput = z.infer<typeof CreateVerificationBody>;
