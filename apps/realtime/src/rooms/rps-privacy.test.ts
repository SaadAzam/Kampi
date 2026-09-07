import { describe, expect, it } from 'vitest';
import { Encoder, Decoder } from '@colyseus/schema';
import { PlayerState, RpsRoomState } from './rps-state.js';

describe('RPS schema privacy', () => {
  it('never encodes a pending choice in automatic state patches', () => {
    const server = new RpsRoomState();
    const player = new PlayerState();
    player.choice = 'ROCK';
    player.choiceLocked = true;
    server.players.set('PLAYER1', player);
    const client = new RpsRoomState();
    new Decoder(client).decode(new Encoder(server).encodeAll());
    expect(client.players.get('PLAYER1')?.choiceLocked).toBe(true);
    expect(client.players.get('PLAYER1')?.choice).toBe('');
  });
});
