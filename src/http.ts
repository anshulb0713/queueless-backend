import { NextFunction, Request, Response } from 'express';

export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const ok = (res: Response, data: unknown, message?: string, status = 200) => res.status(status).json({ success: true, ...(message ? { message } : {}), data });
export const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void fn(req, res, next).catch(next);
export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const error = err instanceof ApiError ? err : new ApiError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  if (!(err instanceof ApiError)) console.error(err);
  res.status(error.status).json({ success: false, message: error.message, errorCode: error.code });
};
