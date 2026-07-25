import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { makeQueryClient, makeWrapper } from '@/test/hooks-harness';
import { ATTACHMENT_MAX_BYTES } from '@tasker/config';

vi.mock('@/lib/http/attachments', () => ({
  attachmentsHttp: {
    sign: vi.fn(),
    confirm: vi.fn(),
  },
  putSignedUpload: vi.fn(),
}));

import { attachmentsHttp, putSignedUpload } from '@/lib/http/attachments';
import { useAttachmentUpload } from './useAttachmentUpload';

const COORDS = { workspaceSlug: 'ws', projectSlug: 'p', taskNumber: 42 };

function makeFile(name: string, size: number, type: string): File {
  const file = new File([new Uint8Array(Math.min(size, 8))], name, { type });
  // jsdom's File derives `size` from the blob contents; override so tests
  // can simulate large or oversized files without allocating megabytes.
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

beforeEach(() => vi.clearAllMocks());

describe('useAttachmentUpload — client-side gates', () => {
  it('flags a file over the size limit as failed with errorKey=tooLarge', async () => {
    const wrapper = makeWrapper({ queryClient: makeQueryClient() });
    const { result } = renderHook(() => useAttachmentUpload(COORDS), { wrapper });
    act(() => {
      result.current.start([makeFile('huge.png', ATTACHMENT_MAX_BYTES + 1, 'image/png')]);
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.status).toBe('failed');
    expect(result.current.items[0]?.errorKey).toBe('tooLarge');
    expect(attachmentsHttp.sign).not.toHaveBeenCalled();
  });

  it('flags a disallowed mime as failed with errorKey=mimeBlocked', async () => {
    const wrapper = makeWrapper({ queryClient: makeQueryClient() });
    const { result } = renderHook(() => useAttachmentUpload(COORDS), { wrapper });
    act(() => {
      result.current.start([makeFile('a.exe', 1000, 'application/x-msdownload')]);
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.status).toBe('failed');
    expect(result.current.items[0]?.errorKey).toBe('mimeBlocked');
    expect(attachmentsHttp.sign).not.toHaveBeenCalled();
  });
});

describe('useAttachmentUpload — happy path', () => {
  it('drives sign → PUT → confirm and lands in status=ready', async () => {
    vi.mocked(attachmentsHttp.sign).mockResolvedValueOnce({
      attachmentId: 'a-1',
      uploadUrl: 'https://s3/put',
      storageKey: 'key',
      expiresAt: '2026-07-25T00:00:00Z',
    });
    vi.mocked(putSignedUpload).mockResolvedValueOnce(undefined);
    vi.mocked(attachmentsHttp.confirm).mockResolvedValueOnce({
      id: 'a-1',
      filename: 'ok.png',
      mime: 'image/png',
      sizeBytes: 100,
      status: 'READY',
      uploaderUserId: 'u-1',
      createdAt: '2026-07-25T00:00:00Z',
    });

    const wrapper = makeWrapper({ queryClient: makeQueryClient() });
    const { result } = renderHook(() => useAttachmentUpload(COORDS), { wrapper });
    act(() => {
      result.current.start([makeFile('ok.png', 100, 'image/png')]);
    });

    await waitFor(() => expect(result.current.items[0]?.status).toBe('ready'));
    expect(attachmentsHttp.sign).toHaveBeenCalledWith('ws', 'p', 42, {
      filename: 'ok.png',
      mime: 'image/png',
      sizeBytes: 100,
    });
    expect(attachmentsHttp.confirm).toHaveBeenCalledWith('ws', 'p', 42, 'a-1');
    expect(result.current.items[0]?.attachmentId).toBe('a-1');
  });

  it('marks the upload as canceled when the abort controller fires', async () => {
    vi.mocked(attachmentsHttp.sign).mockResolvedValueOnce({
      attachmentId: 'a-2',
      uploadUrl: 'https://s3/put',
      storageKey: 'key',
      expiresAt: '2026-07-25T00:00:00Z',
    });
    vi.mocked(putSignedUpload).mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    const wrapper = makeWrapper({ queryClient: makeQueryClient() });
    const { result } = renderHook(() => useAttachmentUpload(COORDS), { wrapper });
    act(() => {
      result.current.start([makeFile('cancel.png', 100, 'image/png')]);
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe('canceled'));
    expect(attachmentsHttp.confirm).not.toHaveBeenCalled();
  });
});
