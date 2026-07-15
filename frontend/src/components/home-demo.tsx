'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

export function HomeDemo() {
  function triggerToast() {
    toast.success('Toast triggered!', {
      description: 'The notification system is working correctly.',
    });
  }

  return (
    <div className="flex items-center gap-4" role="group" aria-label="Demo controls">
      <Button onClick={triggerToast}>Trigger Toast</Button>
      <ThemeToggle />
    </div>
  );
}
