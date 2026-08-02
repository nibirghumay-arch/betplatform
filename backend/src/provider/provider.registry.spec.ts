import { NotFoundException } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry';
import type { ProviderAdapter } from './interfaces/provider-adapter.interface';

function makeAdapter(id: string, name: string): ProviderAdapter {
  return {
    providerId: id,
    displayName: name,
    authenticatePlayer: jest.fn(),
    createSession: jest.fn(),
    launchGame: jest.fn(),
    syncBalance: jest.fn(),
    processBet: jest.fn(),
    processWin: jest.fn(),
    refundRound: jest.fn(),
    getGameCatalog: jest.fn(),
    getGameCategories: jest.fn(),
    updateGame: jest.fn(),
  };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  // ─── register ──────────────────────────────────────────────────────────────

  describe('register', () => {
    it('stores an adapter so it can be retrieved by providerId', () => {
      const adapter = makeAdapter('html5', 'HTML5 Games');
      registry.register(adapter);
      expect(registry.get('html5')).toBe(adapter);
    });

    it('overwrites a previously registered adapter with the same id', () => {
      const first = makeAdapter('html5', 'First');
      const second = makeAdapter('html5', 'Second');
      registry.register(first);
      registry.register(second);
      expect(registry.get('html5')).toBe(second);
    });

    it('can register multiple adapters with different ids', () => {
      registry.register(makeAdapter('html5', 'HTML5'));
      registry.register(makeAdapter('pragmatic', 'Pragmatic Play'));
      expect(registry.listIds()).toEqual(expect.arrayContaining(['html5', 'pragmatic']));
    });
  });

  // ─── get ───────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns the registered adapter', () => {
      const adapter = makeAdapter('html5', 'HTML5 Games');
      registry.register(adapter);
      expect(registry.get('html5')).toBe(adapter);
    });

    it('throws NotFoundException for an unregistered providerId', () => {
      expect(() => registry.get('unknown')).toThrow(NotFoundException);
    });

    it('includes the requested id in the error message', () => {
      expect(() => registry.get('missing-provider')).toThrow(/missing-provider/);
    });

    it('lists available providers in the error message when some are registered', () => {
      registry.register(makeAdapter('html5', 'HTML5'));
      expect(() => registry.get('missing')).toThrow(/html5/);
    });
  });

  // ─── has ───────────────────────────────────────────────────────────────────

  describe('has', () => {
    it('returns true for a registered provider', () => {
      registry.register(makeAdapter('html5', 'HTML5'));
      expect(registry.has('html5')).toBe(true);
    });

    it('returns false for an unregistered provider', () => {
      expect(registry.has('html5')).toBe(false);
    });
  });

  // ─── getAll ────────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns an empty array when no adapters are registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('returns all registered adapters', () => {
      const a = makeAdapter('html5', 'HTML5');
      const b = makeAdapter('pragmatic', 'Pragmatic');
      registry.register(a);
      registry.register(b);
      expect(registry.getAll()).toHaveLength(2);
      expect(registry.getAll()).toEqual(expect.arrayContaining([a, b]));
    });
  });

  // ─── listIds ───────────────────────────────────────────────────────────────

  describe('listIds', () => {
    it('returns an empty array when nothing is registered', () => {
      expect(registry.listIds()).toEqual([]);
    });

    it('returns the ids of all registered adapters', () => {
      registry.register(makeAdapter('a', 'A'));
      registry.register(makeAdapter('b', 'B'));
      expect(registry.listIds()).toEqual(expect.arrayContaining(['a', 'b']));
    });
  });
});
