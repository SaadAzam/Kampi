import { createRandomProvider, type Clock, type RandomProvider } from '../common/index.js';
import type { ColyseusLikeClient, ColyseusLikeRoom } from '../client/index.js';

export class FakeClock implements Clock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}

export function createDeterministicRandom(seedSequence: number[]): RandomProvider {
  let index = 0;
  return createRandomProvider(() => {
    const value = seedSequence[index % seedSequence.length] ?? 0;
    index += 1;
    return value % 1 === value ? value : (value % 1000) / 1000;
  });
}

export class FakeRoom implements ColyseusLikeRoom {
  roomId = 'fake-room';
  sessionId = 'session-1';
  reconnectionToken = 'fake-token';
  private handlers = new Map<string, Array<(payload: unknown) => void>>();
  private leaveHandler?: (code: number) => void;

  send(_type: string, _message?: unknown): void {}

  leave(_consented?: boolean): void {
    this.leaveHandler?.(1000);
  }

  onMessage(type: string, callback: (payload: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(callback);
    this.handlers.set(type, list);
  }

  onLeave(callback: (code: number) => void): void {
    this.leaveHandler = callback;
  }

  emit(type: string, payload: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(payload);
  }
}

export class FakeClient implements ColyseusLikeClient {
  readonly rooms: FakeRoom[] = [];

  async joinOrCreate(_roomName: string, _options?: Record<string, unknown>): Promise<ColyseusLikeRoom> {
    const room = new FakeRoom();
    this.rooms.push(room);
    return room;
  }

  async joinById(_roomId: string, _options?: Record<string, unknown>): Promise<ColyseusLikeRoom> {
    const room = new FakeRoom();
    this.rooms.push(room);
    return room;
  }

  async reconnect(_reconnectionToken: string): Promise<ColyseusLikeRoom> {
    const room = new FakeRoom();
    this.rooms.push(room);
    return room;
  }
}
