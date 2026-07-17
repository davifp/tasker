import 'server-only';

export function backendBaseUrl(): string {
  return (
    process.env['INTERNAL_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
  );
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${backendBaseUrl()}/api/v1${normalized}`;
}
