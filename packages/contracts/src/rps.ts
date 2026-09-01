import { RpsChoice, RoundOutcome, PlayerSlot } from './common.js';

const BEATS: Record<RpsChoice, RpsChoice> = {
  ROCK: 'SCISSORS',
  PAPER: 'ROCK',
  SCISSORS: 'PAPER',
};

export function resolveRpsRound(
  player1Choice: RpsChoice,
  player2Choice: RpsChoice,
): RoundOutcome {
  if (player1Choice === player2Choice) return 'DRAW';
  if (BEATS[player1Choice] === player2Choice) return 'PLAYER1';
  return 'PLAYER2';
}

export function isMatchComplete(
  scores: Record<PlayerSlot, number>,
  bestOf: number,
): PlayerSlot | null {
  const requiredWins = Math.ceil(bestOf / 2);
  if (scores.PLAYER1 >= requiredWins) return 'PLAYER1';
  if (scores.PLAYER2 >= requiredWins) return 'PLAYER2';
  return null;
}

export function shouldConcealChoice(
  playerChoice: RpsChoice | null,
  opponentChoice: RpsChoice | null,
  roundExpired: boolean,
): boolean {
  if (roundExpired) return false;
  if (playerChoice === null) return true;
  if (opponentChoice === null) return true;
  return false;
}

export function getPublicChoice(
  choice: RpsChoice | null,
  opponentChoice: RpsChoice | null,
  roundExpired: boolean,
): RpsChoice | null {
  if (choice === null) return null;
  if (shouldConcealChoice(choice, opponentChoice, roundExpired)) return null;
  return choice;
}

export type RandomSource = {
  nextInt(max: number): number;
  pickChoice(): RpsChoice;
};

export function createRandomSource(random: () => number = Math.random): RandomSource {
  const choices: RpsChoice[] = ['ROCK', 'PAPER', 'SCISSORS'];
  return {
    nextInt(max: number) {
      return Math.floor(random() * max);
    },
    pickChoice() {
      const index = Math.floor(random() * choices.length);
      const choice = choices[index];
      if (!choice) throw new Error('Invalid random choice index');
      return choice;
    },
  };
}
