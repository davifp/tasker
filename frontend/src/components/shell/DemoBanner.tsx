import type { JSX } from 'react';

// Persistent banner shown in read-only demo sessions so visitors immediately
// know that mutations will be rejected. Non-dismissible on purpose — a
// dismissed banner would leave a first-time visitor surprised at the 403
// they get on their first attempt to edit anything.
export function DemoBanner(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-300/60 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <span className="font-medium">Read-only demo.</span> Sign up to create your own workspace and
      try the mutating flows.
    </div>
  );
}
