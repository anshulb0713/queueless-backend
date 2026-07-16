import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextFunction, Response } from 'express';
import { config } from '../config/env.js';
import { ApiError } from './error.middleware.js';
import { AuthRequest, AuthUser, Role } from '../types/index.js';
import { CustomerProfile, CustomerRequest } from '../types/index.js';
import { supabaseAuth } from '../config/supabase.js';
import { query } from '../database/postgres.js';

export const signToken = (user: AuthUser) => jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
export const requireAuth = (roles: Role[] = ['admin', 'staff']) => (req: AuthRequest, _res: Response, next: NextFunction) => {
  const value = req.header('authorization');
  if (!value?.startsWith('Bearer ')) return next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required'));
  try { const user = jwt.verify(value.slice(7), config.jwtSecret) as AuthUser; if (!roles.includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action'); req.user = user; next(); }
  catch (error) { next(error instanceof ApiError ? error : new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired access token')); }
};
export const verifyPassword = (value: string, hash: string) => bcrypt.compare(value, hash);

export const requireCustomerAuth = async (req: CustomerRequest, _res: Response, next: NextFunction) => {
  try {
    const value = req.header('authorization');
    if (!value?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHORIZED', 'A customer access token is required');
    const { data, error } = await supabaseAuth.auth.getUser(value.slice(7));
    const authUser = data.user;
    if (error || !authUser || !authUser.identities?.some(identity => identity.provider === 'google')) {
      throw new ApiError(401, 'UNAUTHORIZED', 'A valid Supabase Google customer session is required');
    }
    const profile = await query<CustomerProfile>(`select id, name, email, mobile, role from public.users where auth_user_id=$1 and role='customer'`, [authUser.id]);
    if (!profile.rowCount || !profile.rows[0].mobile) throw new ApiError(403, 'CUSTOMER_PROFILE_INCOMPLETE', 'Complete your customer profile before joining a queue');
    req.customer = profile.rows[0];
    next();
  } catch (error) { next(error instanceof ApiError ? error : new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired customer access token')); }
};
