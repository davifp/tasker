import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AccessibleChart, buildSummary } from './AccessibleChart';

describe('buildSummary', () => {
  it('returns empty for missing data', () => {
    expect(buildSummary(undefined, 'points')).toBe('');
    expect(buildSummary([], 'points')).toBe('');
  });

  it('renders a single-point sentence', () => {
    expect(buildSummary([{ label: 'Day 1', value: 8 }], 'points')).toBe('Day 1: 8 points.');
  });

  it('renders a multi-point sentence with min/max/average', () => {
    expect(
      buildSummary(
        [
          { label: 'Day 1', value: 10 },
          { label: 'Day 2', value: 6 },
          { label: 'Day 3', value: 2 },
        ],
        'points',
      ),
    ).toBe('3 points from Day 1 to Day 3. Min 2 points, max 10 points, average 6 points.');
  });

  it('formats non-integer averages to one decimal', () => {
    expect(
      buildSummary(
        [
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
        ],
        undefined,
      ),
    ).toBe('2 points from A to B. Min 1, max 2, average 1.5.');
  });
});

describe('AccessibleChart', () => {
  it('exposes aria-label and role=img on the wrapper', () => {
    const { container } = render(
      <AccessibleChart
        ariaLabel="Burndown for Sprint 42"
        data={[{ label: 'Day 1', value: 10 }]}
        units="points"
      >
        <svg data-testid="fake-chart" />
      </AccessibleChart>,
    );
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute('aria-label')).toBe('Burndown for Sprint 42');
  });

  it('renders the visually hidden summary in the a11y tree', () => {
    const { container } = render(
      <AccessibleChart
        ariaLabel="Cycle time"
        data={[
          { label: 'W1', value: 4 },
          { label: 'W2', value: 3 },
        ]}
        units="hours"
      >
        <svg />
      </AccessibleChart>,
    );
    const note = container.querySelector('[role="note"]');
    expect(note?.textContent).toBe(
      '2 points from W1 to W2. Min 3 hours, max 4 hours, average 3.5 hours.',
    );
  });

  it('respects a caller-supplied description', () => {
    const { container } = render(
      <AccessibleChart ariaLabel="Custom" description="Custom summary line.">
        <svg />
      </AccessibleChart>,
    );
    expect(container.querySelector('[role="note"]')?.textContent).toBe('Custom summary line.');
  });
});
