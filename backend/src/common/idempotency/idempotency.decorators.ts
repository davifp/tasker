import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent' as const;

// Marks a handler as idempotent. The IdempotencyInterceptor caches the response
// keyed by the client-supplied Idempotency-Key header and short-circuits replays
// with the byte-identical original response.
export const Idempotent = (): MethodDecorator & ClassDecorator => SetMetadata(IDEMPOTENT_KEY, true);
