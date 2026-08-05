import { describe, expect, it } from 'vitest';
import {
  buildProvenanceMarker,
  extractProvenance,
  parseIssueRef,
  stampProvenance,
} from './provenance';

describe('provenance markers', () => {
  it('buildProvenanceMarker wraps the id in the HTML-comment envelope', () => {
    expect(buildProvenanceMarker('cmt_123')).toBe('<!--tasker:comment=cmt_123-->');
  });

  it('stampProvenance appends the marker on its own paragraph', () => {
    const out = stampProvenance('Hello world.', 'cmt_abc');
    expect(out).toContain('Hello world.');
    expect(out).toContain('<!--tasker:comment=cmt_abc-->');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('extractProvenance round-trips a stamped body', () => {
    const stamped = stampProvenance('Hi there.', 'cmt_id-1');
    expect(extractProvenance(stamped)).toBe('cmt_id-1');
  });

  it('returns null for bodies without a marker', () => {
    expect(extractProvenance('nothing here')).toBeNull();
    expect(extractProvenance('')).toBeNull();
    expect(extractProvenance(null)).toBeNull();
  });

  it('rejects markers with unsafe characters (defence against injection)', () => {
    expect(extractProvenance('body <!--tasker:comment=<script>-->')).toBeNull();
    expect(extractProvenance('body <!--tasker:comment=hi world-->')).toBeNull();
  });

  it('ignores markers without a closing sequence', () => {
    expect(extractProvenance('<!--tasker:comment=cmt_no_end')).toBeNull();
  });
});

describe('parseIssueRef', () => {
  it('parses standard owner/repo#N', () => {
    expect(parseIssueRef('acme/widgets#42')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42,
    });
  });

  it('accepts dashes, dots, and underscores in repo names', () => {
    expect(parseIssueRef('a/b.c_d-e#1')).toEqual({ owner: 'a', repo: 'b.c_d-e', number: 1 });
  });

  it('rejects missing repo', () => {
    expect(parseIssueRef('acme#1')).toBeNull();
  });

  it('rejects zero or negative numbers', () => {
    expect(parseIssueRef('acme/widgets#0')).toBeNull();
    expect(parseIssueRef('acme/widgets#-5')).toBeNull();
  });

  it('rejects trailing garbage', () => {
    expect(parseIssueRef('acme/widgets#42x')).toBeNull();
  });
});
