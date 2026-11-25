import type {z} from 'zod';

export const parseFeed = <T, Payload>(
  schema: z.ZodType<T>,
  payload: Payload,
  label: string,
): T => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  const details = parsed.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

  throw new Error(
    `Invalid ${label} feed shape (${parsed.error.issues.length} issue(s)): ${details}. Check SLOTHHUB_BASE_URL and /api/schema.json.`,
  );
};
