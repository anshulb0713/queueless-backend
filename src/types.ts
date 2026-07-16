import { Request } from 'express';
export type Role = 'admin' | 'staff' | 'customer';
export type TokenStatus = 'waiting' | 'called' | 'serving' | 'skipped' | 'completed' | 'cancelled';
export interface AuthUser { id: string; name: string; role: Role; }
export interface AuthRequest extends Request { user?: AuthUser; }
