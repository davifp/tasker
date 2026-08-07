'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SprintCreateDialog } from './SprintCreateDialog';
import { useWorkspaceRole } from '@/features/workspace/context/WorkspaceRoleContext';

export interface SprintsIndexHeaderProps {
  workspaceSlug: string;
  projectSlug: string;
  projectName: string;
}

export function SprintsIndexHeader({
  workspaceSlug,
  projectSlug,
  projectName,
}: SprintsIndexHeaderProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { canWrite } = useWorkspaceRole();
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-foreground">{projectName}</h2>
      {canWrite ? (
        <Button
          type="button"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid={`sprint-create-open-${projectSlug}`}
        >
          <Plus className="mr-1 h-3 w-3" aria-hidden />
          New sprint
        </Button>
      ) : null}
      {canWrite ? (
        <SprintCreateDialog
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </div>
  );
}
