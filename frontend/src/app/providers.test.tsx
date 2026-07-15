import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { Providers } from './providers';

function QueryClientInspector() {
  const client = useQueryClient();
  return <div data-testid="qc-present">{client ? 'yes' : 'no'}</div>;
}

describe('Providers', () => {
  it('renders children', () => {
    render(
      <Providers>
        <span data-testid="child">hello</span>
      </Providers>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('mounts a QueryClient accessible to children', () => {
    render(
      <Providers>
        <QueryClientInspector />
      </Providers>,
    );

    expect(screen.getByTestId('qc-present')).toHaveTextContent('yes');
  });
});
