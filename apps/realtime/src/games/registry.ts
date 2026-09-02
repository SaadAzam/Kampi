import { GameRegistry } from '@kampi/game-sdk/server';
import { rpsManifest } from '@kampi/game-rps-core';
import { penaltyManifest } from '@kampi/game-penalty';

export function createGameRegistry(): GameRegistry {
  const registry = new GameRegistry();
  registry.register(rpsManifest);
  registry.register(penaltyManifest);
  return registry;
}

export const gameRegistry = createGameRegistry();
