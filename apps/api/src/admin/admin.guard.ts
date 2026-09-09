import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

export function isAdmin(
  user: AuthenticatedRequest['user'],
  ids = process.env.ADMIN_USER_IDS ?? '',
) {
  return Boolean(
    user &&
    !user.isGuest &&
    ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(user.id),
  );
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isAdmin(context.switchToHttp().getRequest<AuthenticatedRequest>().user)) {
      throw new ForbiddenException('Administrator access required');
    }
    return true;
  }
}
