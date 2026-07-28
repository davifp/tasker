import { z } from 'zod';

// -----------------------------------------------------------------------------
// Consent
// -----------------------------------------------------------------------------

export const AcceptConsentInputSchema = z.object({
  documentVersion: z.string().min(1).max(64),
});
export type AcceptConsentInput = z.infer<typeof AcceptConsentInputSchema>;

// -----------------------------------------------------------------------------
// Feedback
// -----------------------------------------------------------------------------

export const SubmitFeedbackInputSchema = z.object({
  invocationId: z.string().cuid(),
  rating: z.enum(['POSITIVE', 'NEGATIVE']),
  reason: z.string().min(1).max(1000).optional(),
});
export type SubmitFeedbackInput = z.infer<typeof SubmitFeedbackInputSchema>;

// -----------------------------------------------------------------------------
// Estimate + suggest — structured output schema shared by prompt + response
// -----------------------------------------------------------------------------

export const EstimateAndSuggestResultSchema = z.object({
  estimate: z.object({
    low: z.number().int().min(0).max(1000),
    high: z.number().int().min(0).max(1000),
    confidence: z.enum(['low', 'medium', 'high']),
  }),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  assignees: z
    .array(
      z.object({
        userId: z.string(),
        reason: z.string().max(200),
      }),
    )
    .max(3),
  insufficientContext: z.boolean(),
});
export type EstimateAndSuggestResult = z.infer<typeof EstimateAndSuggestResultSchema>;

// -----------------------------------------------------------------------------
// Generate checklist — structured output schema
// -----------------------------------------------------------------------------

export const GenerateChecklistResultSchema = z.object({
  items: z.array(z.string().min(1).max(200)).min(1).max(30),
});
export type GenerateChecklistResult = z.infer<typeof GenerateChecklistResultSchema>;
