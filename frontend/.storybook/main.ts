import type { StorybookConfig } from '@storybook/react-vite';

// Storybook 10 with the Vite builder. Addons are opted in individually here
// — the legacy `addon-essentials` bundle was removed in v10 in favor of a
// smaller default install. Add addons back one at a time as we need them
// (a11y, viewport, backgrounds) instead of importing the whole essentials
// pack unconditionally.
//
// Autodocs are opted in per-story via `tags: ['autodocs']` in each meta
// export; v10 removed the top-level `docs.autodocs` config key. TypeScript
// docgen is handled by the Vite plugin at story build time — no top-level
// `typescript.reactDocgen` (that key was webpack-only) needed.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
