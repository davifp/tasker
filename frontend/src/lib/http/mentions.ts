import { browserHttp } from './browser';
import type { MentionSuggestion } from './types';

export const mentionsHttp = {
  search(workspaceSlug: string, query: string, limit = 10) {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('limit', String(limit));
    return browserHttp.get<MentionSuggestion[]>(
      `/workspaces/${workspaceSlug}/members/mention-search?${params.toString()}`,
    );
  },
};
