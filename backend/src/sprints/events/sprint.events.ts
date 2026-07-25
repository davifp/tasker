/**
 * Domain events emitted from `SprintsService` and `SprintPlannerService` and
 * consumed by the metrics processor (Task 5.0) for on-demand matview refresh
 * debouncing. Namespaced under `sprint.*` to match the activity verb prefix.
 */

export const SprintEvents = {
  CREATED: 'sprint.created',
  STARTED: 'sprint.started',
  COMPLETED: 'sprint.completed',
  TASKS_MUTATED: 'sprint.tasks_mutated',
} as const;

export interface SprintCreatedEvent {
  workspaceId: string;
  projectId: string;
  sprintId: string;
  actorUserId: string;
}

export interface SprintStartedEvent {
  workspaceId: string;
  projectId: string;
  sprintId: string;
  actorUserId: string;
}

export interface SprintCompletedEvent {
  workspaceId: string;
  projectId: string;
  sprintId: string;
  actorUserId: string;
}

export interface SprintTasksMutatedEvent {
  workspaceId: string;
  projectId: string;
  sprintId: string;
  actorUserId: string;
  added: string[];
  removed: string[];
}
