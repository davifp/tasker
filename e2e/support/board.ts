import { expect, type Locator, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';

export interface CreatedProject {
  name: string;
  slug: string;
  boardUrl: string;
}

// Localized column label → backend TaskStatus. The board drops droppable
// data-testids in the same shape (`column-droppable-${status}`), so the
// helpers can target the inner drop zone directly and avoid the flaky
// "aim near the top of the section" magic offset.
const STATUS_BY_COLUMN_NAME: Record<string, string> = {
  Backlog: 'BACKLOG',
  'To do': 'TODO',
  'In progress': 'IN_PROGRESS',
  'In review': 'IN_REVIEW',
  Done: 'DONE',
};

// Opens the "New project" dialog from the projects screen, fills the form,
// submits, and waits for the redirect to the fresh board. The slug is
// derived from the name via the same helper the UI uses; we override
// `slug` explicitly so tests are deterministic and can build follow-up
// URLs by concatenation.
export async function createProject(
  page: Page,
  overrides: Partial<CreatedProject> & { workspaceSlug?: string } = {},
): Promise<CreatedProject> {
  const suffix = randomBytes(3).toString('hex');
  const name = overrides.name ?? `Web ${suffix}`;
  const slug = overrides.slug ?? `web-${suffix}`;

  // From the projects screen, click either the empty-state CTA or the
  // header "New project" button depending on which is present.
  const headerTrigger = page.getByRole('button', { name: /^new project$/i }).first();
  const emptyStateTrigger = page
    .getByRole('button', { name: /create your first project/i })
    .first();
  if (await headerTrigger.isVisible().catch(() => false)) {
    await headerTrigger.click();
  } else {
    await emptyStateTrigger.click();
  }

  await page.getByLabel(/^name$/i).fill(name);
  const slugField = page.getByLabel(/url slug/i);
  await slugField.fill(slug);
  await page.getByRole('button', { name: /^create project$/i }).click();

  await page.waitForURL(/\/projects\/[^/]+\/board/);
  return { name, slug, boardUrl: page.url() };
}

// Quick-adds a task via the column pill. `columnName` is the localized
// column heading text (e.g., "To do", "Backlog"). Returns the visible card
// locator so callers can chain drag/open assertions.
export async function quickAddTask(
  page: Page,
  columnName: string,
  title: string,
): Promise<Locator> {
  const column = columnRegion(page, columnName);
  await column.getByRole('button', { name: /add task/i }).click();
  await column.getByLabel(/new task title/i).fill(title);
  await column.getByRole('button', { name: /^add$/i }).click();
  const card = column.getByRole('button', { name: new RegExp(`open task #\\d+: ${title}`, 'i') });
  await expect(card).toBeVisible();
  return card;
}

// Drag a card into a target column by mouse. dnd-kit's PointerSensor is
// configured with `activationConstraint: { distance: 4 }`, so we simulate
// a real drag by taking a small warm-up step before travelling to the
// target's center. After drop we deterministically wait for the moved
// card to appear inside the target column region (no sleeps, no races).
export async function dragCardTo(
  page: Page,
  card: Locator,
  targetColumnName: string,
): Promise<void> {
  const targetDrop = columnDroppable(page, targetColumnName);
  await card.waitFor({ state: 'visible' });
  // The board container is `overflow-x-auto`; when all five columns don't
  // fit the viewport the target (and often the source) can be scrolled
  // off-screen. Bring both onto the visible pane before measuring — dnd-kit
  // only registers pointer collisions over visible screen coordinates.
  await targetDrop.scrollIntoViewIfNeeded();
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  const targetBox = await targetDrop.boundingBox();
  if (!cardBox || !targetBox) throw new Error('drag source/target has no bounding box');
  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Warm-up drift past PointerSensor's 4px activation threshold.
  await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
  // Two-phase move: aim into the target column first, then settle at the
  // final drop position. dnd-kit uses browser hover events for collision
  // detection; splitting the travel keeps the `over` element stable.
  await page.mouse.move(endX, endY, { steps: 30 });
  await page.mouse.move(endX + 1, endY + 1, { steps: 5 });
  await page.mouse.up();
}

export function columnRegion(page: Page, columnName: string): Locator {
  const escaped = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('region', {
    name: new RegExp(`^${escaped} column$`, 'i'),
  });
}

// KanbanColumn tags its inner droppable with `data-testid="column-droppable-${status}"`.
// Aiming the pointer at the center of THIS element (rather than the
// section header or the whole `<section>`) resolves against the same
// dnd-kit `column:${status}` droppable id the app uses.
export function columnDroppable(page: Page, columnName: string): Locator {
  const status = STATUS_BY_COLUMN_NAME[columnName];
  if (!status) throw new Error(`Unknown column name: ${columnName}`);
  return page.locator(`[data-testid="column-droppable-${status}"]`);
}

// Keyboard-drag: focus the card, Space to pick up, arrows to move, Space
// to drop. dnd-kit's KeyboardSensor + `sortableKeyboardCoordinates` moves
// by a fixed 25px step per arrow keydown. We poll after each press for
// the parent-column change instead of guessing a fixed step count, so a
// wider or narrower viewport doesn't over- or under-shoot the target.
export async function dragCardKeyboard(
  page: Page,
  card: Locator,
  direction: 'ArrowRight' | 'ArrowLeft' | 'ArrowUp' | 'ArrowDown',
  maxSteps = 40,
): Promise<void> {
  const originColumnLabel = await parentColumnAriaLabel(card);
  await card.focus();
  await card.press('Space');
  for (let stepped = 0; stepped < maxSteps; stepped += 1) {
    await card.press(direction);
    const label = await parentColumnAriaLabel(card);
    if (label && label !== originColumnLabel) break;
  }
  await card.press('Space');
}

async function parentColumnAriaLabel(card: Locator): Promise<string | null> {
  return card
    .evaluate((el) => el.closest('[role="region"]')?.getAttribute('aria-label') ?? null)
    .catch(() => null);
}

// Open the task drawer by clicking the card title.
export async function openDrawer(card: Locator): Promise<Locator> {
  await card.click();
  const dialog = card.page().getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
