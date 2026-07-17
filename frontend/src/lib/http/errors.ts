export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}

export class HttpError extends Error implements ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly traceId?: string;
  readonly errors?: Record<string, string[]>;

  constructor(data: ProblemDetails) {
    super(data.title);
    this.name = 'HttpError';
    this.type = data.type;
    this.title = data.title;
    this.status = data.status;
    this.detail = data.detail;
    this.instance = data.instance;
    this.traceId = data.traceId;
    this.errors = data.errors;
  }

  static async fromResponse(response: Response): Promise<HttpError> {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (
      contentType.includes('application/problem+json') ||
      contentType.includes('application/json')
    ) {
      try {
        const problem = (await response.json()) as Partial<ProblemDetails>;
        return new HttpError({
          type: problem.type ?? 'about:blank',
          title: problem.title ?? response.statusText,
          status: problem.status ?? response.status,
          detail: problem.detail,
          instance: problem.instance,
          traceId: problem.traceId,
          errors: problem.errors,
        });
      } catch {
        // fall through to generic
      }
    }
    return new HttpError({
      type: 'about:blank',
      title: response.statusText || `HTTP ${response.status}`,
      status: response.status,
    });
  }
}
