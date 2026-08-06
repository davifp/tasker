import type { Preview } from '@storybook/react-vite';
import '../src/app/globals.css';

// Global Tailwind + design-system styles apply to every story. The `light`
// class toggles the shadcn theme; the story panel picker (once addon-themes
// is added) will flip between light and dark on demand.
const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#0b0b0f' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default preview;
