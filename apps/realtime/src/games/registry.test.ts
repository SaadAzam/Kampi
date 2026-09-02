import { describe, expect, it } from 'vitest';
import { createGameRegistry } from './registry.js';

describe('realtime game registry', () => {
  it('registers RPS and Penalty Duel once', () => {
    const registry = createGameRegistry();
    expect(registry.has('rock-paper-scissors')).toBe(true);
    expect(registry.has('penalty-duel')).toBe(true);
    expect(registry.get('penalty-duel').roomName).toBe('penalty-duel');
    expect(registry.get('rock-paper-scissors').roomName).toBe('rps');
  });
});
