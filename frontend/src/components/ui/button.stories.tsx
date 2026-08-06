import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Default: Story = { args: { children: 'Create task' } };
export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete workspace' },
};
export const Outline: Story = { args: { variant: 'outline', children: 'Cancel' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Duplicate' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Skip' } };
export const Link: Story = { args: { variant: 'link', children: 'View details' } };
export const Small: Story = { args: { size: 'sm', children: 'Small' } };
export const Large: Story = { args: { size: 'lg', children: 'Large primary' } };
export const Disabled: Story = { args: { disabled: true, children: 'Not available' } };
