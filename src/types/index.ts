import { Request } from 'express';
export type Role = 'admin' | 'staff' | 'customer';
export type TokenStatus = 'waiting' | 'called' | 'serving' | 'skipped' | 'completed' | 'cancelled';
export interface AuthUser { id: string; name: string; role: Role; }
export interface AuthRequest extends Request { user?: AuthUser; }
export interface CustomerProfile { id: string; name: string; email: string; mobile: string; role: 'customer'; }
export interface CustomerRequest extends Request { customer?: CustomerProfile; }

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      customer?: CustomerProfile;
    }
  }
}
