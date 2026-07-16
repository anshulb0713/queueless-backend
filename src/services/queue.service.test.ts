import { describe, expect, it } from 'vitest';
import { ApiError } from '../middlewares/error.middleware.js';
import { assertTransition, transitions } from './queue.service.js';

describe('token state machine', () => {
  it('allows the documented customer and staff lifecycle transitions', () => {
    expect(() => assertTransition('waiting', 'called')).not.toThrow();
    expect(() => assertTransition('called', 'serving')).not.toThrow();
    expect(() => assertTransition('serving', 'completed')).not.toThrow();
    expect(() => assertTransition('skipped', 'waiting')).not.toThrow();
  });

  it('rejects a terminal or out-of-order transition', () => {
    expect(() => assertTransition('completed', 'waiting')).toThrow(ApiError);
    expect(() => assertTransition('waiting', 'completed')).toThrow(ApiError);
    expect(transitions.cancelled).toEqual([]);
  });
});
