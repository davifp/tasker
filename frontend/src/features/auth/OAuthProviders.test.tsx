import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { OAuthProviders } from './OAuthProviders';
import { renderWithIntl } from '@/test-utils/render-with-intl';

describe('OAuthProviders', () => {
  it('renders Google and GitHub buttons on signup as links to the backend', () => {
    renderWithIntl(<OAuthProviders action="signup" />);
    const google = screen.getByRole('link', { name: /sign up with google/i });
    const github = screen.getByRole('link', { name: /sign up with github/i });
    expect(google).toHaveAttribute('href', '/api/proxy/auth/oauth/google');
    expect(github).toHaveAttribute('href', '/api/proxy/auth/oauth/github');
  });

  it('uses the Sign in copy on the signin variant', () => {
    renderWithIntl(<OAuthProviders action="signin" />);
    expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
  });
});
