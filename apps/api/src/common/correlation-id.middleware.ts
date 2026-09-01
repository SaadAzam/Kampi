import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function CorrelationIdMiddleware(
  req: Request & { correlationId?: string },
  res: Response,
  next: NextFunction,
) {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
}
