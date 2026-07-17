const MAILHOG_URL = process.env['MAILHOG_URL'] ?? 'http://localhost:8025';

interface MailhogMessage {
  ID: string;
  Content: {
    Headers: {
      To?: string[];
      Subject?: string[];
    };
    Body: string;
  };
}

async function fetchMessages(): Promise<MailhogMessage[]> {
  const response = await fetch(`${MAILHOG_URL}/api/v2/messages`);
  if (!response.ok) return [];
  const data = (await response.json()) as { items?: MailhogMessage[] };
  return data.items ?? [];
}

export async function waitForEmail(
  matcher: (email: MailhogMessage) => boolean,
  timeoutMs = 20_000,
): Promise<MailhogMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const items = await fetchMessages();
    const found = items.find(matcher);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for email in MailHog');
}

export function extractFirstUrl(body: string): string | null {
  // Undo quoted-printable soft line breaks ("=\r\n" or "=\n") and the ASCII-hex escapes (=3D),
  // then unescape HTML entities the mail template uses (&#x3D; for '=').
  const normalized = body
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/&#x3D;/gi, '=')
    .replace(/&amp;/g, '&');
  const match = normalized.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}

export async function purgeMessages(): Promise<void> {
  await fetch(`${MAILHOG_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
}
