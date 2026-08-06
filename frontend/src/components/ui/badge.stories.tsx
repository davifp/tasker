import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'outline'],
    },
  },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Default: Story = { args: { children: 'Active' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Backlog' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Blocked' } };
export const Outline: Story = { args: { variant: 'outline', children: 'Read-only' } };
