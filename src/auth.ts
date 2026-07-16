import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextFunction, Response } from 'express';
import { config } from './config.js';
import { ApiError } from './http.js';
import { AuthRequest, AuthUser, Role } from './types.js';

export const signToken = (user: AuthUser) => jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
export const requireAuth = (roles: Role[] = ['admin', 'staff']) => (req: AuthRequest, _res: Response, next: NextFunction) => {
  const value = req.header('authorization');
  if (!value?.startsWith('Bearer ')) return next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required'));
  try { const user = jwt.verify(value.slice(7), config.jwtSecret) as AuthUser; if (!roles.includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action'); req.user = user; next(); }
  catch (error) { next(error instanceof ApiError ? error : new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired access token')); }
};
export const verifyPassword = (value: string, hash: string) => bcrypt.compare(value, hash);
