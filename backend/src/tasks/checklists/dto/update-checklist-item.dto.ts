import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { positionKeySchema } from '../../dto/move-task.dto';
import { checklistTitleSchema } from './create-checklist-item.dto';

export class UpdateChecklistItemDto extends createZodDto(
  z
    .object({
      title: checklistTitleSchema.optional(),
      checked: z.boolean().optional(),
      // When reordering, callers supply a fractional-indexing key computed
      // client-side between the two adjacent items.
      position: positionKeySchema.optional(),
    })
    .refine(
      (patch) =>
        patch.title !== undefined ||
        patch.checked !== undefined ||
        patch.position !== undefined,
      { message: 'At least one of title, checked, or position must be provided' },
    ),
) {}
