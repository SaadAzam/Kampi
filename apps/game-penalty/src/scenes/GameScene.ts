import Phaser from 'phaser';
import { GameSessionClient } from '@kampi/game-sdk/client';
import { GameEmbedClient } from '@kampi/game-sdk/embed';
import { PENALTY_GAME_ID } from '@kampi/game-penalty';
import { runtimeConfig, setAuthToken } from '../config.js';

type Seat = 'A' | 'B';
type Reveal = {
  turnId: string;
  sequence: number;
  kickerSeat: Seat;
  outcome: string;
  shot: string | null;
  dive: string | null;
};
type Snapshot = {
  matchId: string;
  phase: string;
  serverNow: number;
  players: Array<{
    seat: Seat;
    displayName: string;
    score: number;
    connected: boolean;
    isBot: boolean;
  }>;
  inSuddenDeath: boolean;
  suddenDeathPair: number;
  activeTurn: {
    turnId: string;
    sequence: number;
    kickerSeat: Seat;
    goalkeeperSeat: Seat;
    deadlineAt: number;
    kickerLocked: boolean;
    goalkeeperLocked: boolean;
  } | null;
  revealedHistory: Reveal[];
  winnerSeat: Seat | null;
  finishReason: string | null;
  abortReason?: string | null;
  yourSeat?: Seat;
};

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function mirror(id: string, value: string) {
  const el = document.querySelector(`[data-testid="${id}"]`);
  if (el) el.textContent = value;
}

export class GameScene extends Phaser.Scene {
  private session?: GameSessionClient;
  private embed?: GameEmbedClient;
  private snapshot?: Snapshot;
  private mySeat?: Seat;
  private lastRevealTurnId?: string;
  private submittedTurn?: string;
  private ball!: Phaser.GameObjects.Arc;
  private keeper!: Phaser.GameObjects.Container;
  private reducedMotion = false;
  private busy = false;
  private finished = false;
  private serverNow = 0;
  private receivedAt = 0;
  private eventsAbort = new AbortController();

  constructor() {
    super('GameScene');
  }

  create() {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.drawStadium();
    this.scale.on('resize', this.drawStadium, this);
    const signal = this.eventsAbort.signal;
    element('left').addEventListener('click', () => this.submit('LEFT'), { signal });
    element('right').addEventListener('click', () => this.submit('RIGHT'), { signal });
    element('find').addEventListener('click', () => void this.start('public'), { signal });
    element('private').addEventListener('click', () => void this.start('private'), { signal });
    element('join-form').addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        void this.start('join');
      },
      { signal },
    );
    element('cancel').addEventListener(
      'click',
      () => {
        this.session?.destroy();
        this.session = undefined;
        this.busy = false;
        element('invite').hidden = true;
        this.status('Search cancelled. Ready when you are.');
        this.controls();
      },
      { signal },
    );
    this.events.once('shutdown', () => {
      this.eventsAbort.abort();
      this.session?.destroy();
      this.embed?.destroy();
      this.scale.off('resize', this.drawStadium, this);
    });
    // Existing integration hooks submit intentions through the same visible controls.
    (window as unknown as { __kampiPenalty: object }).__kampiPenalty = {
      findMatch: () => this.start('public'),
      createPrivate: () => this.start('private'),
      joinPrivate: () => this.start('join'),
      submitLeft: () => this.submit('LEFT'),
      submitRight: () => this.submit('RIGHT'),
    };
    this.setupEmbed();
    void this.bootstrapAuth();
  }

  private status(value: string) {
    mirror('status', value);
  }
  private now() {
    return this.serverNow + performance.now() - this.receivedAt;
  }
  override update() {
    const turn = this.snapshot?.activeTurn;
    const remaining = turn ? Math.max(0, turn.deadlineAt - this.now()) : 0;
    element('timer').textContent = turn ? `${Math.ceil(remaining / 1000)}s` : '—';
    if (turn && remaining === 0) this.actionControls(false);
  }

  private drawStadium() {
    this.tweens.killAll();
    this.children.removeAll(true);
    const w = this.scale.width,
      h = this.scale.height;
    const g = this.add.graphics();
    g.fillStyle(0x0e2533);
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 30; col++) {
        g.fillStyle((col + row) % 3 === 0 ? 0x3d6681 : 0x254253, 0.8);
        g.fillCircle((col * w) / 29, h * (0.08 + row * 0.045), 2);
      }
    g.fillStyle(0x17604c);
    g.fillRect(0, h * 0.28, w, h);
    for (let i = 0; i < 7; i++) {
      g.fillStyle(0x1d7356, 0.5);
      g.fillRect(0, h * (0.28 + i * 0.12), w, h * 0.06);
    }
    g.lineStyle(2, 0xb5dcc9, 0.5);
    g.strokeRect(w * 0.08, h * 0.32, w * 0.84, h * 0.61);
    const x = w * 0.15,
      y = h * 0.22,
      gw = w * 0.7,
      gh = h * 0.3;
    g.fillStyle(0x061b29, 0.4);
    g.fillRect(x, y, gw, gh);
    g.lineStyle(1, 0xb7d7df, 0.22);
    for (let i = 1; i < 14; i++) g.lineBetween(x + (gw * i) / 14, y, x + (gw * i) / 14, y + gh);
    for (let i = 1; i < 6; i++) g.lineBetween(x, y + (gh * i) / 6, x + gw, y + (gh * i) / 6);
    g.lineStyle(4, 0xe5f1ed);
    g.strokeRect(x, y, gw, gh);
    const body = this.add.rectangle(0, 5, 24, 31, 0x73aaff);
    const head = this.add.circle(0, -18, 10, 0xf3c99c);
    const arms = this.add.rectangle(0, 0, 49, 8, 0x73aaff);
    const legs = this.add.rectangle(0, 29, 21, 20, 0x16253e);
    this.keeper = this.add
      .container(w / 2, h * 0.41, [arms, body, head, legs])
      .setScale(Math.min(w / 400, h / 300));
    this.add.ellipse(w / 2, h * 0.83 + 10, 34, 9, 0x062a28, 0.4);
    this.ball = this.add
      .circle(w / 2, h * 0.83, Math.max(9, Math.min(w * 0.032, 16)), 0xf8fcff)
      .setStrokeStyle(2, 0xb7c9d4);
  }

  private actionControls(enabled: boolean) {
    for (const id of ['left', 'right']) element<HTMLButtonElement>(id).disabled = !enabled;
  }
  private controls() {
    const available = Boolean(runtimeConfig.authToken) && (!this.busy || this.finished);
    for (const id of ['find', 'private', 'join'])
      element<HTMLButtonElement>(id).disabled = !available;
    element('cancel').hidden = !this.busy || Boolean(this.snapshot && !this.finished);
    element('find').textContent = this.finished
      ? 'Play again'
      : this.busy
        ? 'Finding your opponent…'
        : 'Find match';
  }

  private setupEmbed() {
    if (window.parent === window) return;
    const origin = import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:3000';
    this.embed = new GameEmbedClient({
      parentOrigin: origin,
      allowedOrigins: [origin],
      onMessage: (message) => {
        if (message.type === 'session') {
          if (runtimeConfig.authToken !== message.authToken) {
            this.session?.destroy();
            this.session = undefined;
          }
          setAuthToken(message.authToken);
          this.status('Ready. Find an opponent or challenge a friend.');
          this.controls();
        }
      },
    });
    this.embed.notifyReady(PENALTY_GAME_ID);
  }

  private async bootstrapAuth() {
    if (window.parent !== window) {
      this.status('Connecting to your Kampi session…');
      return;
    }
    try {
      if (!runtimeConfig.authToken) {
        const response = await fetch(`${runtimeConfig.apiUrl}/auth/guest`, { method: 'POST' });
        if (!response.ok) throw new Error('Open Kampi and sign in to play.');
        const body = (await response.json()) as { token: string };
        setAuthToken(body.token);
      }
      this.status('Ready. Find an opponent or challenge a friend.');
    } catch (error) {
      this.status(
        error instanceof Error ? error.message : 'Could not connect. Please reload to retry.',
      );
    }
    this.controls();
  }

  private ensureSession() {
    if (this.session) return this.session;
    const session = new GameSessionClient({
      realtimeUrl: runtimeConfig.realtimeUrl,
      authToken: runtimeConfig.authToken,
      gameId: PENALTY_GAME_ID,
    });
    this.session = session;
    session.on('status', (status) => {
      if (status === 'reconnecting') {
        this.status('Connection lost. Reconnecting to your match…');
        this.actionControls(false);
      }
      if (status === 'queued')
        this.status('Looking for an opponent. A bot joins if nobody is available.');
    });
    session.on('match_found', (payload) => {
      this.mySeat = payload.seat;
      mirror('match-id', payload.matchId);
      mirror('seat', payload.seat);
      element('invite').hidden = true;
      element('cancel').hidden = true;
      this.status(
        payload.botFill ? 'Matched with a bot. Get ready!' : 'Opponent found. Get ready!',
      );
      this.embed?.postToHost({
        type: 'match_started',
        matchId: payload.matchId,
        gameSlug: PENALTY_GAME_ID,
      });
    });
    session.on('snapshot', (payload) => {
      this.snapshot = payload as Snapshot;
      this.serverNow = this.snapshot.serverNow;
      this.receivedAt = performance.now();
      this.mySeat = this.snapshot.yourSeat ?? this.mySeat;
      this.renderSnapshot(this.snapshot);
    });
    session.on('match_completed', (payload) => {
      const data = payload as { winnerSeat: Seat; payout: string | null };
      if (this.snapshot)
        this.embed?.postToHost({
          type: 'match_completed',
          matchId: this.snapshot.matchId,
          result: data.winnerSeat === this.mySeat ? 'WIN' : 'LOSS',
          payout: data.winnerSeat === this.mySeat ? data.payout : null,
        });
    });
    session.on('invite_created', (payload) => {
      element('invite').textContent =
        `Your invite: ${payload.code} · Share it with a friend. Expires in 10 minutes.`;
      element('invite').hidden = false;
      this.status('Waiting for your friend to join.');
      this.controls();
    });
    session.on('error', (payload) => {
      this.status(payload.message);
      if (!this.snapshot || this.finished) {
        session.destroy();
        this.session = undefined;
        this.busy = false;
      }
      this.controls();
    });
    return session;
  }

  private async start(mode: 'public' | 'private' | 'join') {
    if ((this.busy && !this.finished) || !runtimeConfig.authToken) return;
    const code = element<HTMLInputElement>('invite-code').value.trim().toUpperCase();
    if (mode === 'join' && !/^[A-Z0-9]{4,12}$/.test(code)) {
      this.status('Enter a valid invite code.');
      return;
    }
    this.session?.destroy();
    this.session = undefined;
    this.snapshot = undefined;
    this.mySeat = undefined;
    this.submittedTurn = undefined;
    this.lastRevealTurnId = undefined;
    this.finished = false;
    this.busy = true;
    mirror('result', '');
    mirror('score', '0 - 0');
    element('history').replaceChildren();
    this.drawStadium();
    this.controls();
    this.actionControls(false);
    this.status('Connecting to matchmaking…');
    const session = this.ensureSession();
    try {
      if (mode === 'public') await session.joinQueue();
      else if (mode === 'private') await session.createPrivateSession();
      else await session.joinPrivateSession(code);
    } catch {
      session.destroy();
      this.session = undefined;
      this.busy = false;
      this.status('Could not join. Check your connection and try again.');
      this.controls();
    }
  }

  private submit(direction: 'LEFT' | 'RIGHT') {
    const turn = this.snapshot?.activeTurn;
    if (
      !this.session ||
      !turn ||
      !this.mySeat ||
      this.snapshot?.phase !== 'AWAITING_ACTIONS' ||
      this.submittedTurn === turn.turnId ||
      this.now() >= turn.deadlineAt
    )
      return;
    const kicker = this.mySeat === turn.kickerSeat;
    if (kicker ? turn.kickerLocked : turn.goalkeeperLocked) return;
    this.submittedTurn = turn.turnId;
    this.actionControls(false);
    this.session.sendAction('submit_action', {
      commandId: crypto.randomUUID(),
      matchId: this.snapshot.matchId,
      turnId: turn.turnId,
      action: `${kicker ? 'SHOOT' : 'DIVE'}_${direction}`,
    });
    this.status(`${direction === 'LEFT' ? 'Left' : 'Right'} locked. Waiting for the reveal…`);
  }

  private renderSnapshot(snapshot: Snapshot) {
    const a = snapshot.players.find((p) => p.seat === 'A'),
      b = snapshot.players.find((p) => p.seat === 'B');
    mirror('score', `${a?.score ?? 0} - ${b?.score ?? 0}`);
    mirror('match-id', snapshot.matchId);
    if (this.mySeat) mirror('seat', this.mySeat);
    for (const player of snapshot.players)
      element(`player-${player.seat.toLowerCase()}`).textContent =
        `${player.seat === this.mySeat ? 'You' : player.displayName}${player.isBot ? ' · BOT' : player.connected ? '' : ' · reconnecting'}`;
    const turn = snapshot.activeTurn;
    this.finished = snapshot.phase === 'FINISHED' || snapshot.phase === 'ABORTED';
    this.actionControls(false);
    if (turn && this.mySeat) {
      const kicker = this.mySeat === turn.kickerSeat;
      const locked =
        (kicker ? turn.kickerLocked : turn.goalkeeperLocked) || this.submittedTurn === turn.turnId;
      mirror('role', kicker ? 'YOU ARE THE KICKER' : 'YOU ARE THE GOALKEEPER');
      element('left').textContent = kicker ? '← Shoot left' : '← Dive left';
      element('right').textContent = kicker ? 'Shoot right →' : 'Dive right →';
      mirror('result', '');
      this.status(
        locked
          ? 'Choice locked. Waiting for the reveal…'
          : `${snapshot.inSuddenDeath ? `Sudden death · pair ${snapshot.suddenDeathPair}` : `Kick ${turn.sequence} of 6`} · ${kicker ? 'Beat the keeper.' : 'Read the shot.'}`,
      );
      this.actionControls(!locked && this.now() < turn.deadlineAt);
    } else mirror('role', this.finished ? 'Match complete' : 'Get ready');
    const latest = snapshot.revealedHistory.at(-1);
    if (latest && latest.turnId !== this.lastRevealTurnId) {
      this.lastRevealTurnId = latest.turnId;
      if (!this.finished && snapshot.phase === 'REVEALING_RESULT') this.playReveal(latest);
      element('history').replaceChildren(
        ...snapshot.revealedHistory.map((turn) => {
          const item = document.createElement('span');
          item.textContent = `${turn.sequence} · ${turn.kickerSeat === this.mySeat ? 'You' : 'Rival'} · ${turn.outcome.toLowerCase()}`;
          return item;
        }),
      );
    }
    if (this.finished) {
      this.tweens.killAll();
      mirror(
        'result',
        snapshot.phase === 'ABORTED'
          ? 'MATCH CANCELLED'
          : snapshot.winnerSeat === this.mySeat
            ? 'YOU WIN'
            : 'YOU LOSE',
      );
      this.status(
        snapshot.phase === 'ABORTED'
          ? `${snapshot.abortReason ?? 'Match cancelled'}. Any charged entry has been refunded.`
          : `FINISHED · ${snapshot.finishReason === 'FORFEIT' ? 'Opponent or player left the match' : 'Well played'}. Ready for another duel?`,
      );
    }
    this.controls();
  }

  private playReveal(turn: Reveal) {
    mirror('result', turn.outcome);
    this.status(
      turn.outcome === 'MISS' ? 'No shot before the deadline.' : 'Both choices revealed.',
    );
    if (this.reducedMotion) return;
    this.tweens.killAll();
    const w = this.scale.width,
      h = this.scale.height;
    this.ball.setPosition(w / 2, h * 0.83);
    this.keeper.setPosition(w / 2, h * 0.41);
    const target = (direction: string | null) =>
      direction === 'LEFT' ? w * 0.25 : direction === 'RIGHT' ? w * 0.75 : w / 2;
    this.tweens.add({
      targets: this.keeper,
      x: target(turn.dive),
      angle: turn.dive === 'LEFT' ? -30 : turn.dive === 'RIGHT' ? 30 : 0,
      duration: 380,
      yoyo: true,
      hold: 500,
    });
    this.tweens.add({
      targets: this.ball,
      x: target(turn.shot),
      y: turn.outcome === 'MISS' ? h * 0.12 : h * 0.43,
      scale: 0.65,
      duration: 480,
      onComplete: () => {
        this.time.delayedCall(500, () => {
          if (!this.finished) this.ball.setPosition(w / 2, h * 0.83).setScale(1);
        });
      },
    });
  }
}
