import { SetMetadata } from '@nestjs/common';

// Applied to Bearer-token / API-key controllers whose auth is not carried by
// cookies — they cannot be targeted by CSRF and do not need a token cookie.
export const SKIP_CSRF_KEY = 'skip_csrf';
export const SkipCsrf = (): ClassDecorator & MethodDecorator => SetMetadata(SKIP_CSRF_KEY, true);
