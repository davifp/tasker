import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './input';
import { Label } from './label';
import { Badge } from './badge';
import { Separator } from './separator';
import { Skeleton } from './skeleton';

describe('shadcn primitives smoke renders', () => {
  it('renders Input with associated Label', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" defaultValue="test@example.com" />
      </>,
    );
    expect(screen.getByLabelText('Email')).toHaveValue('test@example.com');
  });

  it('renders Badge with text content', () => {
    render(<Badge>Owner</Badge>);
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('renders Separator with proper role', () => {
    render(<Separator />);
    expect(screen.getByRole('none', { hidden: true })).toBeInTheDocument();
  });

  it('renders Skeleton placeholder', () => {
    render(<Skeleton data-testid="skel" className="h-4 w-20" />);
    expect(screen.getByTestId('skel')).toBeInTheDocument();
  });
});
