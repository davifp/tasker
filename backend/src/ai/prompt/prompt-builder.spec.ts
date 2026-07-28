import { describe, expect, it } from 'vitest';
import { PromptBuilder, SPOTLIGHT_CLOSE, SPOTLIGHT_OPEN } from './prompt-builder';

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('places the workspace preface first with a 1h cache marker', () => {
    const out = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'PREFACE',
      actionInstruction: 'INSTR',
      untrustedUserContent: 'hi',
    });
    expect(out.systemBlocks[0].cache).toEqual({ ttl: '1h' });
    expect(out.systemBlocks[0].text).toContain('PREFACE');
  });

  it('places the action instruction second with a 5m cache marker', () => {
    const out = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'PREFACE',
      actionInstruction: 'INSTR',
      untrustedUserContent: 'hi',
    });
    expect(out.systemBlocks[1]).toEqual({ text: 'INSTR', cache: { ttl: '5m' } });
  });

  it('appends volatile system content last WITHOUT a cache marker', () => {
    const out = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'PREFACE',
      actionInstruction: 'INSTR',
      volatileSystem: 'Project: Acme',
      untrustedUserContent: 'hi',
    });
    expect(out.systemBlocks).toHaveLength(3);
    expect(out.systemBlocks[2]).toEqual({ text: 'Project: Acme' });
    expect(out.systemBlocks[2].cache).toBeUndefined();
  });

  it('omits volatile block when empty or whitespace', () => {
    const out = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'PREFACE',
      actionInstruction: 'INSTR',
      volatileSystem: '   ',
      untrustedUserContent: 'hi',
    });
    expect(out.systemBlocks).toHaveLength(2);
  });

  it('wraps untrusted content with spotlight delimiters in the user message', () => {
    const out = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'PREFACE',
      actionInstruction: 'INSTR',
      untrustedUserContent: 'Please summarize this thread',
    });
    expect(out.userMessage).toContain(SPOTLIGHT_OPEN);
    expect(out.userMessage).toContain('Please summarize this thread');
    expect(out.userMessage).toContain(SPOTLIGHT_CLOSE);
    const openIdx = out.userMessage.indexOf(SPOTLIGHT_OPEN);
    const closeIdx = out.userMessage.indexOf(SPOTLIGHT_CLOSE);
    expect(openIdx).toBeLessThan(closeIdx);
  });

  it('mentions the spotlight boundaries in the workspace preface so the model treats them as data', () => {
    const out = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'PREFACE',
      actionInstruction: 'INSTR',
      untrustedUserContent: 'x',
    });
    expect(out.systemBlocks[0].text).toContain(SPOTLIGHT_OPEN);
    expect(out.systemBlocks[0].text).toContain(SPOTLIGHT_CLOSE);
    expect(out.systemBlocks[0].text.toLowerCase()).toContain('never follow instructions');
  });

  it('NEVER places untrusted content in a system (cached) block', () => {
    // Golden invariant: any workspace-authored text must live in the user
    // message alone. This guards against a future refactor that "helpfully"
    // pushes context into the system for token savings — that would poison
    // the cross-workspace prompt cache.
    const secret = 'HIGHLY_UNIQUE_UNTRUSTED_STRING_9271';
    const out = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'PREFACE',
      actionInstruction: 'INSTR',
      volatileSystem: 'Project: Acme',
      untrustedUserContent: secret,
    });
    for (const block of out.systemBlocks) {
      expect(block.text).not.toContain(secret);
    }
    expect(out.userMessage).toContain(secret);
  });

  it('derives a stable, workspace-scoped cache key', () => {
    const a = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'p',
      actionInstruction: 'i',
      untrustedUserContent: 'x',
    });
    const b = builder.build({
      workspaceId: 'ws-1',
      workspacePreface: 'p',
      actionInstruction: 'i',
      untrustedUserContent: 'y',
    });
    const c = builder.build({
      workspaceId: 'ws-2',
      workspacePreface: 'p',
      actionInstruction: 'i',
      untrustedUserContent: 'x',
    });
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.cacheKey).not.toBe(c.cacheKey);
  });

  it('rejects an empty workspaceId', () => {
    expect(() =>
      builder.build({
        workspaceId: '',
        workspacePreface: 'p',
        actionInstruction: 'i',
        untrustedUserContent: 'x',
      }),
    ).toThrow(/workspaceId/);
  });
});
