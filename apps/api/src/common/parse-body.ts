import { BadRequestException } from '@nestjs/common';

type ParseIssue = { path: PropertyKey[]; message: string };
type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: ParseIssue[] } };

export function parseBody<T>(
  schema: { safeParse: (data: unknown) => SafeParseResult<T> },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
