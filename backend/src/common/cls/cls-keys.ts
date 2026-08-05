export const CLS_TRACE_ID = 'traceId';
export const CLS_SPAN_ID = 'spanId';
export const CLS_USER_ID = 'userId';
export const CLS_WORKSPACE_ID = 'workspaceId';
export const CLS_RELEASE_ID = 'releaseId';

export type ClsLogContext = {
  [CLS_TRACE_ID]?: string;
  [CLS_SPAN_ID]?: string;
  [CLS_USER_ID]?: string;
  [CLS_WORKSPACE_ID]?: string;
  [CLS_RELEASE_ID]?: string;
};
