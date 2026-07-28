import { SetMetadata } from '@nestjs/common';

/**
 * Marker for AI routes that MUST remain reachable regardless of consent
 * state. Applied to the `/consent` endpoints themselves — otherwise the
 * admin would need to accept the consent to reach the endpoint that
 * records the acceptance, a chicken-and-egg deadlock.
 *
 * Also allowed by design: `GET /ai/usage` (dashboard visibility) even
 * before consent, so admins can preview the budget knob.
 */
export const AI_CONSENT_SKIP_KEY = 'aiConsentSkip';
export const SkipAiConsent = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AI_CONSENT_SKIP_KEY, true);
