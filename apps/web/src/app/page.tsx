'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HostEmbedController } from '@kampi/game-sdk/embed';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'kampi.authToken';

type PlayerStats = {
  xp: number;
  level: number;
  wins: number;
  losses: number;
  draws: number;
  games: Array<{
    gameSlug: string;
    gameName: string;
    xp: number;
    level: number;
    wins: number;
    losses: number;
    draws: number;
  }>;
};

type Player = {
  id: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
  balance: string;
  stats: PlayerStats;
};

type GameCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  clientUrl: string;
  entryFee: string;
  winnerPayout: string;
};

type LeaderboardBoard = {
  gameSlug: string;
  gameName: string;
  periodKey: string;
  entries: Array<{ rank: number; userId: string; displayName: string; score: number }>;
};

type AuthMode = 'login' | 'register' | 'claim';

function readStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* Session remains in memory. */
  }
}

function clearStoredToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Storage may be blocked. */
  }
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const payload = 'error' in body ? body.error : body;
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = payload.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message))
      return message.filter((item) => typeof item === 'string').join(', ');
  }
  return fallback;
}

function emptyStats(): PlayerStats {
  return { xp: 0, level: 1, wins: 0, losses: 0, draws: 0, games: [] };
}

export default function HomePage() {
  const [view, setView] = useState<'home' | 'rankings' | 'account'>('home');
  const bootstrapped = useRef(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [token, setToken] = useState('');
  const [games, setGames] = useState<GameCard[]>([]);
  const [boards, setBoards] = useState<LeaderboardBoard[]>([]);
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking');
  const [guestAvailable, setGuestAvailable] = useState(false);
  const [activeGame, setActiveGame] = useState<GameCard | null>(null);
  const [embedMessage, setEmbedMessage] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const embedRef = useRef<HostEmbedController | null>(null);
  const playerRef = useRef(player);
  const tokenRef = useRef(token);

  playerRef.current = player;
  tokenRef.current = token;

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void bootstrap();
  }, []);

  useEffect(
    () => () => {
      embedRef.current?.destroy();
    },
    [activeGame],
  );

  function connectFrame() {
    if (!activeGame || !tokenRef.current) return;
    const iframe = document.getElementById('game-frame') as HTMLIFrameElement | null;
    if (!iframe?.contentWindow) return;
    embedRef.current?.destroy();
    const origin = new URL(activeGame.clientUrl).origin;
    const controller = new HostEmbedController({
      targetWindow: iframe.contentWindow,
      targetOrigin: origin,
      allowedOrigins: [origin],
      onMessage: (message) => {
        if (message.type === 'game_ready')
          controller.sendSession(tokenRef.current, playerRef.current?.id);
        if (message.type === 'match_started') setEmbedMessage('Match in progress');
        if (message.type === 'match_completed') setEmbedMessage('Match complete');
        if (message.type === 'balance_changed' || message.type === 'match_completed') {
          void refreshPlayer(tokenRef.current).catch(() => undefined);
          void loadLeaderboard().catch(() => undefined);
        }
      },
    });
    embedRef.current = controller;
    controller.send({ type: 'host_ready', protocolVersion: '1.0.0' });
    controller.sendSession(tokenRef.current, playerRef.current?.id);
  }

  async function applySession(authToken: string) {
    storeToken(authToken);
    setToken(authToken);
    tokenRef.current = authToken;
    const loaded = await refreshPlayer(authToken);
    return loaded;
  }

  async function refreshPlayer(authToken: string): Promise<boolean> {
    if (!authToken) return false;
    const playerRes = await fetch(`${API_URL}/players/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!playerRes.ok) return false;
    setPlayer((await playerRes.json()) as Player);
    return true;
  }

  async function loadCatalog() {
    const [gamesRes, healthRes, authConfigRes] = await Promise.all([
      fetch(`${API_URL}/games`),
      fetch(`${API_URL}/health/live`),
      fetch(`${API_URL}/auth/config`),
    ]);
    if (gamesRes.ok) {
      const body = (await gamesRes.json()) as { games: GameCard[] };
      setGames(
        body.games.map((game) => ({
          ...game,
          clientUrl:
            (game.slug === 'penalty-duel'
              ? process.env.NEXT_PUBLIC_GAME_PENALTY_URL
              : process.env.NEXT_PUBLIC_GAME_RPS_URL) || game.clientUrl,
        })),
      );
    }
    setConnection(healthRes.ok ? 'online' : 'offline');
    if (authConfigRes.ok) {
      const config = (await authConfigRes.json()) as { guestAuthEnabled: boolean };
      setGuestAvailable(config.guestAuthEnabled);
      return config.guestAuthEnabled;
    }
    setGuestAvailable(false);
    return false;
  }

  async function loadLeaderboard() {
    const res = await fetch(`${API_URL}/stats/leaderboard?period=weekly`);
    if (!res.ok) return;
    const body = (await res.json()) as { boards: LeaderboardBoard[] };
    setBoards(body.boards);
  }

  async function probeGuest(): Promise<boolean> {
    const res = await fetch(`${API_URL}/auth/guest`, { method: 'POST' });
    if (!res.ok) return false;
    const guest = (await res.json()) as { token: string };
    return applySession(guest.token);
  }

  async function bootstrap() {
    try {
      const guestsOn = await loadCatalog();
      await loadLeaderboard();
      const stored = readStoredToken();
      if (stored && (await applySession(stored))) return;
      if (stored) {
        clearStoredToken();
        setToken('');
        tokenRef.current = '';
      }
      if (guestsOn) await probeGuest();
    } catch {
      setConnection('offline');
    }
  }

  async function createGuest() {
    setAuthError('');
    setAuthBusy(true);
    try {
      const ok = await probeGuest();
      if (!ok) {
        setAuthError('Guest play is disabled. Create an account to continue.');
      }
    } catch {
      setAuthError('Could not create a guest session.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const displayName = String(form.get('displayName') ?? '').trim();

    const path = player?.isGuest
      ? '/auth/claim'
      : authMode === 'login'
        ? '/auth/login'
        : '/auth/register';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (player?.isGuest && token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          password,
          ...(displayName ? { displayName } : {}),
        }),
      });
      const body: unknown = await res.json();
      const tokenValue =
        body && typeof body === 'object' && 'token' in body && typeof body.token === 'string'
          ? body.token
          : null;
      if (!res.ok || !tokenValue) {
        setAuthError(apiErrorMessage(body, 'Authentication failed'));
        return;
      }
      await applySession(tokenValue);
      await loadLeaderboard();
      setAuthMode('login');
      setView('home');
    } catch {
      setAuthError('Could not reach the API.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    if (token) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    clearStoredToken();
    setToken('');
    setPlayer(null);
    setAuthMode('login');
  }

  function openGame(game: GameCard) {
    setEmbedMessage('');
    const url = new URL(game.clientUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    setActiveGame(game);
  }

  function closeGame() {
    embedRef.current?.destroy();
    embedRef.current = null;
    setActiveGame(null);
    setEmbedMessage('');
    if (token) void refreshPlayer(token).catch(() => undefined);
    void loadLeaderboard().catch(() => undefined);
  }

  const stats = player?.stats ?? emptyStats();
  const activeProgression = stats.games.find((game) => game.gameSlug === activeGame?.slug);

  return (
    <main className="app-shell">
      <header className="header">
        <button
          className="brand"
          onClick={() => {
            if (activeGame) closeGame();
            setView('home');
          }}
          aria-label="Kampi home"
        >
          <span className="brand-mark">K</span>
          <span>
            Kampi<span className="brand-suffix">.fun</span>
          </span>
        </button>
        <button
          className="wallet-pill"
          onClick={() => {
            if (activeGame) closeGame();
            setView('account');
          }}
          aria-label="Open account and balance"
        >
          <span className="chip-icon">K</span>
          {player ? BigInt(player.balance).toLocaleString() : 'Sign in'}
          <span className="wallet-label">{player ? 'chips' : 'to play'}</span>
        </button>
      </header>

      {activeGame ? (
        <section className="play-layout" aria-label={`${activeGame.name} session`}>
          <div className="play-main">
            <div className="play-toolbar">
              <button type="button" className="back-button" onClick={closeGame}>
                ← Back to lobby
              </button>
              <h2 className="play-title">{activeGame.name}</h2>
              {embedMessage ? <p className="embed-status">{embedMessage}</p> : null}
            </div>
            <iframe
              id="game-frame"
              className="game-frame"
              src={activeGame.clientUrl}
              title={activeGame.name}
              allow="fullscreen"
              onLoad={connectFrame}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
            />
          </div>

          <aside className="play-sidebar" aria-label="Player stats">
            <div className="card sidebar-card">
              <h2>Player</h2>
              <p className="stat-name">{player?.displayName ?? 'Guest'}</p>
              <dl className="stat-list">
                <div>
                  <dt>Balance</dt>
                  <dd>{player?.balance ?? '…'} chips</dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd>{activeGame.entryFee} chips</dd>
                </div>
                <div>
                  <dt>Win payout</dt>
                  <dd>{activeGame.winnerPayout} chips</dd>
                </div>
                <div>
                  <dt>Game</dt>
                  <dd>{activeGame.name}</dd>
                </div>
              </dl>
            </div>
            <ProgressionCard stats={stats} game={activeProgression} />
          </aside>
        </section>
      ) : (
        <>
          <section className="account-panel" hidden={view !== 'account'} aria-label="Your account">
            <div className="section-heading">
              <h2>Your account</h2>
              <span>Keep your progress</span>
            </div>
            <div className="grid-2" style={{ marginTop: 12 }}>
              <AuthCard
                player={player}
                guestAvailable={guestAvailable}
                authMode={player?.isGuest ? 'claim' : authMode}
                authError={authError}
                authBusy={authBusy}
                onModeChange={setAuthMode}
                onSubmit={(event) => void submitAuth(event)}
                onGuest={() => void createGuest()}
                onLogout={() => void logout()}
              />
              <ProgressionCard stats={stats} />
            </div>
          </section>

          <section hidden={view !== 'home'} aria-label="Game lobby">
            <div className="hero">
              <div>
                <span className="eyebrow">QUICK GAMES. REAL RIVALRIES.</span>
                <h2>
                  Your next win
                  <br />
                  starts here.
                </h2>
                <p>One opponent. A few minutes. All you.</p>
                <button onClick={() => setView(player ? 'rankings' : 'account')}>
                  {player ? 'View rankings' : 'Start playing'} <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="hero-emblem" aria-hidden="true">
                K<span>1 v 1</span>
              </div>
            </div>
            <div className="activity-strip">
              <span>
                <i className={connection === 'online' ? 'online-dot' : 'offline-dot'} />
                {connection === 'online'
                  ? 'Arena online'
                  : connection === 'checking'
                    ? 'Connecting…'
                    : 'Arena offline'}
              </span>
              <span>Level {stats.level}</span>
              <span>{stats.wins} wins</span>
            </div>
            <div className="section-heading">
              <h2>
                1v1 Games <span className="heading-dot">✦</span>
              </h2>
              <span>{games.length} games</span>
            </div>
            {connection === 'offline' ? (
              <p className="empty-state">
                The arena is temporarily unavailable.{' '}
                <button
                  onClick={() => {
                    setConnection('checking');
                    void bootstrap();
                  }}
                >
                  Retry connection
                </button>
              </p>
            ) : null}
            <div className="game-grid">
              {games.map((game) => (
                <article
                  key={game.id}
                  className={`game-card ${game.slug === 'penalty-duel' ? 'penalty-card' : 'rps-card'}`}
                >
                  <div className="game-art" aria-hidden="true">
                    <span className="game-badge">
                      {game.slug === 'penalty-duel' ? 'SPOTLIGHT' : 'CLASSIC'}
                    </span>
                    <div className="placeholder-art">
                      {game.slug === 'penalty-duel' ? '⚽' : '✊ ✋ ✌'}
                    </div>
                    <span className="art-caption">
                      {game.slug === 'penalty-duel' ? 'READ THE SHOT' : 'MAKE YOUR MOVE'}
                    </span>
                  </div>
                  <div className="game-card-body">
                    <h3>{game.name}</h3>
                    <p className="game-description">
                      {game.slug === 'penalty-duel'
                        ? 'Shoot. Save. Outplay your rival.'
                        : 'Three choices. One winner.'}
                    </p>
                    <p className="game-economy">
                      ◈ {BigInt(game.entryFee).toLocaleString()} entry{' '}
                      <span>Win {BigInt(game.winnerPayout).toLocaleString()}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => (player ? openGame(game) : setView('account'))}
                      style={{ marginTop: 8 }}
                      className="play-button"
                    >
                      {player ? 'Play now' : 'Sign in to play'} <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="card rankings" hidden={view !== 'rankings'}>
            <div className="section-heading">
              <h2>Weekly rankings</h2>
              <span>Top players</span>
            </div>
            <p className="muted">Win duels. Climb the board. A new race every week.</p>
            {boards.length === 0 ? (
              <p>No ranked matches yet this week.</p>
            ) : (
              <div className="grid-2" style={{ marginTop: 12 }}>
                {boards.map((board) => (
                  <article key={board.gameSlug}>
                    <h3>{board.gameName}</h3>
                    {board.entries.length === 0 ? (
                      <p>No wins recorded yet.</p>
                    ) : (
                      <ol className="leaderboard-list">
                        {board.entries.map((entry) => (
                          <li key={entry.userId}>
                            <span>
                              {entry.rank}. {entry.displayName}
                            </span>
                            <strong>{entry.score} wins</strong>
                          </li>
                        ))}
                      </ol>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          <p className="lobby-note">
            Made for a quick break. Played for the bragging rights.
            <br />
            <span>Virtual chips only · No cash-out</span>
          </p>
          <nav className="bottom-nav" aria-label="Primary navigation">
            <button
              aria-current={view === 'home' ? 'page' : undefined}
              onClick={() => setView('home')}
            >
              <span aria-hidden="true">⌂</span>Home
            </button>
            <button
              aria-current={view === 'rankings' ? 'page' : undefined}
              onClick={() => setView('rankings')}
            >
              <span aria-hidden="true">♜</span>Rankings
            </button>
            <button
              aria-current={view === 'account' ? 'page' : undefined}
              onClick={() => setView('account')}
            >
              <span aria-hidden="true">◎</span>Account
            </button>
          </nav>
        </>
      )}
    </main>
  );
}

function ProgressionCard({
  stats,
  game,
}: {
  stats: PlayerStats;
  game?: PlayerStats['games'][number];
}) {
  return (
    <div className="card sidebar-card">
      <h2>Progression</h2>
      <dl className="stat-list">
        <div>
          <dt>Level</dt>
          <dd>{game?.level ?? stats.level}</dd>
        </div>
        <div>
          <dt>XP</dt>
          <dd>{game?.xp ?? stats.xp}</dd>
        </div>
        <div>
          <dt>Wins</dt>
          <dd>{game?.wins ?? stats.wins}</dd>
        </div>
        <div>
          <dt>Losses</dt>
          <dd>{game?.losses ?? stats.losses}</dd>
        </div>
      </dl>
    </div>
  );
}

function AuthCard({
  player,
  guestAvailable,
  authMode,
  authError,
  authBusy,
  onModeChange,
  onSubmit,
  onGuest,
  onLogout,
}: {
  player: Player | null;
  guestAvailable: boolean;
  authMode: AuthMode;
  authError: string;
  authBusy: boolean;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onGuest: () => void;
  onLogout: () => void;
}) {
  const showForm = !player || player.isGuest;
  const heading = player?.isGuest ? 'Save this account' : player ? 'Player' : 'Sign in';

  return (
    <div className="card">
      <h2>{heading}</h2>
      {player ? (
        <>
          <p>{player.displayName}</p>
          <p>Balance: {player.balance} chips</p>
          {player.email ? (
            <p className="muted">{player.email}</p>
          ) : (
            <p className="muted">Guest session</p>
          )}
        </>
      ) : (
        <p>Create an account or play as a guest.</p>
      )}

      {showForm ? (
        <form className="auth-form" onSubmit={onSubmit}>
          {!player ? (
            <div className="auth-tabs">
              <button
                type="button"
                className={authMode === 'login' ? undefined : 'ghost-button'}
                onClick={() => onModeChange('login')}
              >
                Log in
              </button>
              <button
                type="button"
                className={authMode === 'register' ? undefined : 'ghost-button'}
                onClick={() => onModeChange('register')}
              >
                Register
              </button>
            </div>
          ) : null}
          {authMode !== 'login' ? (
            <label>
              Display name
              <input
                name="displayName"
                type="text"
                minLength={2}
                maxLength={32}
                placeholder="Optional"
              />
            </label>
          ) : null}
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {authError ? <p className="form-error">{authError}</p> : null}
          <button type="submit" disabled={authBusy}>
            {authMode === 'login'
              ? 'Log in'
              : authMode === 'claim'
                ? 'Save account'
                : 'Create account'}
          </button>
        </form>
      ) : null}

      <div className="auth-actions">
        {player ? (
          <button type="button" className="ghost-button" onClick={onLogout} disabled={authBusy}>
            Log out
          </button>
        ) : null}
        {guestAvailable ? (
          <button type="button" className="ghost-button" onClick={onGuest} disabled={authBusy}>
            {player ? 'New guest identity' : 'Play as guest'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
