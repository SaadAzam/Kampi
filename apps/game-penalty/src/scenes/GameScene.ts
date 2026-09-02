import Phaser from 'phaser';
import { GameSessionClient } from '@kampi/game-sdk/client';
import { GameEmbedClient } from '@kampi/game-sdk/embed';
import { PENALTY_GAME_ID } from '@kampi/game-penalty';
import { runtimeConfig, setAuthToken } from '../config.js';

type Snapshot = {
  matchId: string;
  phase: string;
  serverNow: number;
  players: Array<{
    seat: 'A' | 'B';
    displayName: string;
    score: number;
    connected: boolean;
    isBot: boolean;
  }>;
  inSuddenDeath: boolean;
  activeTurn: {
    turnId: string;
    kickerSeat: 'A' | 'B';
    goalkeeperSeat: 'A' | 'B';
    deadlineAt: number;
    kickerLocked: boolean;
    goalkeeperLocked: boolean;
  } | null;
  revealedHistory: Array<{
    turnId: string;
    outcome: string;
    shot: string | null;
    dive: string | null;
  }>;
  winnerSeat: 'A' | 'B' | null;
  finishReason: string | null;
  yourSeat?: 'A' | 'B';
};

type AnimState =
  | 'IDLE'
  | 'KICK_LEFT'
  | 'KICK_RIGHT'
  | 'DIVE_LEFT'
  | 'DIVE_RIGHT'
  | 'GOAL'
  | 'SAVE'
  | 'MISS'
  | 'RESET';

function escapeText(value: string): string {
  return value.replace(/[<>&"]/g, (c) => ({ '<': '', '>': '', '&': '', '"': '' })[c] ?? '');
}

export class GameScene extends Phaser.Scene {
  private session?: GameSessionClient;
  private embed?: GameEmbedClient;
  private snapshot?: Snapshot;
  private mySeat?: 'A' | 'B';
  private lastRevealTurnId?: string;
  private animState: AnimState = 'IDLE';
  private statusText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private roleText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private resultText!: Phaser.GameObjects.Text;
  private ball!: Phaser.GameObjects.Arc;
  private keeper!: Phaser.GameObjects.Rectangle;
  private reducedMotion = false;
  private inviteCode = '';

  constructor() {
    super('GameScene');
  }

  create() {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.drawStadium();
    this.createHud();
    this.createControls();
    this.exposeTestApi();
    this.setupEmbed();
    void this.bootstrapAuth();
  }

  private setDom(testId: string, value: string) {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) el.textContent = value;
  }

  /** Playwright hooks — no visible DOM controls; Phaser buttons are the UI. */
  private exposeTestApi() {
    const api = {
      findMatch: () => void this.findMatch(),
      createPrivate: () => void this.createPrivate(),
      joinPrivate: () => void this.joinPrivate(),
      submitLeft: () => this.submit('LEFT'),
      submitRight: () => this.submit('RIGHT'),
    };
    (window as unknown as { __kampiPenalty?: typeof api }).__kampiPenalty = api;
  }

  override update() {
    if (!this.snapshot?.activeTurn) {
      this.timerText.setText('');
      return;
    }
    const remaining = Math.max(0, this.snapshot.activeTurn.deadlineAt - Date.now());
    this.timerText.setText(`${Math.ceil(remaining / 1000)}s`);
  }

  private drawStadium() {
    const w = this.scale.width;
    const h = this.scale.height;
    const g = this.add.graphics();
    g.fillStyle(0x0b3d2e, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(0x146c43, 1);
    g.fillRect(0, h * 0.35, w, h * 0.65);
    g.lineStyle(4, 0xffffff, 0.8);
    g.strokeRect(w * 0.15, h * 0.18, w * 0.7, h * 0.22);
    g.strokeRect(w * 0.28, h * 0.18, w * 0.44, h * 0.12);

    this.keeper = this.add.rectangle(w / 2, h * 0.32, 36, 56, 0x1d4ed8).setDepth(5);
    this.ball = this.add.circle(w / 2, h * 0.62, 14, 0xf8fafc).setDepth(6);
    this.add.rectangle(w / 2, h * 0.72, 40, 70, 0xdc2626).setDepth(5);
  }

  private createHud() {
    this.add
      .text(16, 12, 'KAMPI · Penalty Duel', {
        fontSize: '16px',
        color: '#ecfdf5',
        fontStyle: 'bold',
      })
      .setDepth(20);
    this.scoreText = this.add
      .text(this.scale.width / 2, 40, '0 - 0', {
        fontSize: '28px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(20);
    this.statusText = this.add
      .text(16, 70, 'Ready', { fontSize: '14px', color: '#d1fae5', wordWrap: { width: this.scale.width - 32 } })
      .setDepth(20);
    this.roleText = this.add
      .text(16, 100, '', { fontSize: '18px', color: '#fef08a', fontStyle: 'bold' })
      .setDepth(20);
    this.timerText = this.add
      .text(this.scale.width - 24, 40, '', { fontSize: '24px', color: '#fff' })
      .setOrigin(1, 0.5)
      .setDepth(20);
    this.resultText = this.add
      .text(this.scale.width / 2, this.scale.height * 0.5, '', {
        fontSize: '22px',
        color: '#fff',
      })
      .setOrigin(0.5)
      .setDepth(20);
  }

  private createControls() {
    const y = this.scale.height - 120;
    this.makeButton(this.scale.width * 0.28, y, 'LEFT', 0x2563eb, () => this.submit('LEFT'));
    this.makeButton(this.scale.width * 0.72, y, 'RIGHT', 0xdc2626, () => this.submit('RIGHT'));
    this.makeButton(this.scale.width / 2, y - 70, 'Find Match', 0x059669, () => void this.findMatch());
    this.makeButton(this.scale.width * 0.28, y - 130, 'Create Private', 0x0f766e, () =>
      void this.createPrivate(),
    );
    this.makeButton(this.scale.width * 0.72, y - 130, 'Join Code', 0x155e75, () => void this.joinPrivate());
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void,
  ) {
    const btn = this.add
      .rectangle(x, y, 130, 48, color)
      .setInteractive({ useHandCursor: true })
      .setDepth(20);
    this.add
      .text(x, y, label, { fontSize: '14px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(21);
    btn.on('pointerdown', onClick);
  }

  private setupEmbed() {
    if (window.parent === window) return;
    const parentOrigin = import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:3000';
    this.embed = new GameEmbedClient({
      parentOrigin,
      allowedOrigins: [parentOrigin],
      onMessage: (message) => {
        if (message.type === 'session') {
          setAuthToken(message.authToken);
          this.statusText.setText('Session received');
        }
      },
    });
    this.embed.notifyReady(PENALTY_GAME_ID);
  }

  private async bootstrapAuth() {
    if (runtimeConfig.authToken) {
      this.statusText.setText('Authenticated — Find Match or Create Private');
      return;
    }
    if (window.parent !== window) {
      this.statusText.setText('Waiting for platform session…');
      return;
    }
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/auth/guest`, { method: 'POST' });
      if (!response.ok) throw new Error('guest auth failed');
      const body = (await response.json()) as { token: string; user: { displayName: string } };
      setAuthToken(body.token);
      this.statusText.setText(`Playing as ${escapeText(body.user.displayName)}`);
    } catch {
      this.statusText.setText('Auth failed — start API with DEV_GUEST_AUTH_ENABLED');
    }
  }

  private ensureSession(): GameSessionClient {
    if (!runtimeConfig.authToken) throw new Error('No auth token');
    if (!this.session) {
      this.session = new GameSessionClient({
        realtimeUrl: runtimeConfig.realtimeUrl,
        authToken: runtimeConfig.authToken,
        gameId: PENALTY_GAME_ID,
      });
      this.session.on('status', (status) => {
        if (status === 'queued') {
          this.statusText.setText('Joining matchmaking queue…');
          this.setDom('status', 'Joining matchmaking queue…');
        }
        if (status === 'reconnecting') {
          this.statusText.setText('Reconnecting…');
          this.setDom('status', 'Reconnecting…');
        }
      });
      this.session.on('match_found', (payload) => {
        this.mySeat = payload.seat;
        this.statusText.setText(
          payload.botFill ? 'Bot joined — match starting' : 'Opponent found!',
        );
        this.setDom('status', payload.botFill ? 'Bot joined' : 'Opponent found');
        this.setDom('match-id', payload.matchId);
        this.setDom('seat', payload.seat);
        this.embed?.postToHost({
          type: 'match_started',
          matchId: payload.matchId,
          gameSlug: PENALTY_GAME_ID,
        });
      });
      this.session.on('snapshot', (payload) => {
        this.snapshot = payload as Snapshot;
        if (this.snapshot.yourSeat) this.mySeat = this.snapshot.yourSeat;
        this.renderSnapshot(this.snapshot);
      });
      this.session.on('match_completed', (payload) => {
        const data = payload as { winnerSeat: string; payout: string | null };
        const won = data.winnerSeat === this.mySeat;
        this.resultText.setText(won ? 'YOU WIN' : 'YOU LOSE');
        this.embed?.postToHost({
          type: 'match_completed',
          matchId: this.snapshot?.matchId ?? '00000000-0000-4000-8000-000000000000',
          result: won ? 'WIN' : 'LOSS',
          payout: data.payout,
        });
      });
      this.session.on('invite_created', (payload) => {
        this.inviteCode = payload.code;
        this.statusText.setText(`Invite code: ${payload.code} — share with opponent`);
      });
      this.session.on('error', (payload) => {
        this.statusText.setText(`${payload.code}: ${payload.message}`);
      });
    }
    return this.session;
  }

  private async findMatch() {
    const session = this.ensureSession();
    this.statusText.setText('Joining matchmaking queue…');
    this.setDom('status', 'Joining matchmaking queue…');
    await session.joinQueue();
  }

  private async createPrivate() {
    const session = this.ensureSession();
    await session.createPrivateSession();
  }

  private async joinPrivate() {
    const code = window.prompt('Enter invite code');
    if (!code) return;
    const session = this.ensureSession();
    await session.joinPrivateSession(code.trim().toUpperCase());
  }

  private submit(direction: 'LEFT' | 'RIGHT') {
    if (!this.session || !this.snapshot?.activeTurn || !this.mySeat) return;
    if (this.snapshot.phase !== 'AWAITING_ACTIONS') return;
    const turn = this.snapshot.activeTurn;
    const amKicker = this.mySeat === turn.kickerSeat;
    if (amKicker && turn.kickerLocked) return;
    if (!amKicker && turn.goalkeeperLocked) return;

    const action = amKicker
      ? direction === 'LEFT'
        ? 'SHOOT_LEFT'
        : 'SHOOT_RIGHT'
      : direction === 'LEFT'
        ? 'DIVE_LEFT'
        : 'DIVE_RIGHT';

    this.session.sendAction('submit_action', {
      commandId: crypto.randomUUID(),
      turnId: turn.turnId,
      action,
    });
    this.statusText.setText(`Locked ${direction}`);
  }

  private renderSnapshot(snapshot: Snapshot) {
    const a = snapshot.players.find((p) => p.seat === 'A');
    const b = snapshot.players.find((p) => p.seat === 'B');
    const scoreLabel = `${a?.score ?? 0} - ${b?.score ?? 0}`;
    this.scoreText.setText(scoreLabel);
    this.setDom('score', scoreLabel);
    this.setDom('match-id', snapshot.matchId);
    if (this.mySeat) this.setDom('seat', this.mySeat);

    if (snapshot.inSuddenDeath) {
      this.statusText.setText('Sudden death');
      this.setDom('status', 'Sudden death');
    }

    if (snapshot.activeTurn && this.mySeat) {
      const amKicker = this.mySeat === snapshot.activeTurn.kickerSeat;
      const role = amKicker ? 'YOU ARE THE KICKER' : 'YOU ARE THE GOALKEEPER';
      this.roleText.setText(role);
      this.setDom('role', role);
      this.setDom('status', snapshot.phase);
    } else {
      this.roleText.setText('');
      this.setDom('role', '');
    }

    const latest = snapshot.revealedHistory.at(-1);
    if (latest && latest.turnId !== this.lastRevealTurnId) {
      this.lastRevealTurnId = latest.turnId;
      this.playReveal(latest);
    }

    if (snapshot.phase === 'FINISHED') {
      const label =
        snapshot.winnerSeat === this.mySeat ? 'YOU WIN' : `Winner: ${snapshot.winnerSeat}`;
      this.resultText.setText(label);
      this.setDom('result', label);
      this.setDom('status', 'FINISHED');
    }
    if (snapshot.phase === 'ABORTED') {
      const label = `Aborted: ${snapshot.finishReason ?? ''}`;
      this.resultText.setText(label);
      this.setDom('result', label);
    }
  }

  private playReveal(turn: { outcome: string; shot: string | null; dive: string | null }) {
    if (this.reducedMotion) {
      this.resultText.setText(turn.outcome);
      return;
    }
    const shot = turn.shot === 'LEFT' ? 'KICK_LEFT' : turn.shot === 'RIGHT' ? 'KICK_RIGHT' : 'IDLE';
    this.animState = shot as AnimState;
    const targetX =
      turn.shot === 'LEFT'
        ? this.scale.width * 0.35
        : turn.shot === 'RIGHT'
          ? this.scale.width * 0.65
          : this.scale.width / 2;
    this.tweens.add({
      targets: this.ball,
      x: targetX,
      y: this.scale.height * 0.28,
      duration: 450,
      onComplete: () => {
        this.animState = turn.outcome as AnimState;
        this.resultText.setText(turn.outcome);
        const diveX =
          turn.dive === 'LEFT'
            ? this.scale.width * 0.35
            : turn.dive === 'RIGHT'
              ? this.scale.width * 0.65
              : this.scale.width / 2;
        this.tweens.add({
          targets: this.keeper,
          x: diveX,
          duration: 250,
          yoyo: true,
          onComplete: () => {
            this.animState = 'RESET';
            this.ball.setPosition(this.scale.width / 2, this.scale.height * 0.62);
            this.keeper.setPosition(this.scale.width / 2, this.scale.height * 0.32);
            this.animState = 'IDLE';
          },
        });
      },
    });
  }
}
