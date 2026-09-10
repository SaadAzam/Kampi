'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HostEmbedController } from '@kampi/game-sdk/embed';
import { LobbyHeader, LobbyNavigation, type LobbyView } from '../components/LobbyChrome';
import { LobbyHome } from '../components/LobbyHome';

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

type MatchHistory = {
  matchId: string;
  gameName: string;
  opponent: string;
  score: number;
  opponentScore: number;
  status: string;
  result: string | null;
  createdAt: string;
  botFill: boolean;
};

type AuthMode = 'login' | 'register' | 'claim';

async function request(url: string, options: Parameters<typeof fetch>[1] = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

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
  const [view, setView] = useState<LobbyView>('home');
  const bootstrapped = useRef(false);
  const bootstrapBusy = useRef(false);
  const sessionEpoch = useRef(0);
  const focusAfterNavigation = useRef(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [player, setPlayer] = useState<Player | null>(null);
  const [token, setToken] = useState('');
  const [games, setGames] = useState<GameCard[]>([]);
  const [history, setHistory] = useState<MatchHistory[]>([]);
  const [historyError, setHistoryError] = useState('');
  const restoredGame = useRef(false);
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

  useEffect(() => {
    if (!token || !player || !games.length || restoredGame.current) return;
    restoredGame.current = true;
    try {
      const slug = sessionStorage.getItem('kampi.activeGame');
      const game = games.find((item) => item.slug === slug);
      if (game) openGame(game);
    } catch {
      /* optional storage */
    }
  }, [token, player, games]);

  useEffect(() => {
    if (!token) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshPlayer(token).catch(() => undefined);
      void loadHistory(token);
      void loadLeaderboard().catch(() => undefined);
    };
    void loadHistory(token);
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [token]);

  async function loadHistory(authToken: string) {
    try {
      const res = await request(`${API_URL}/matches/history?limit=30`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('History is temporarily unavailable.');
      const body = (await res.json()) as { matches: MatchHistory[] };
      if (tokenRef.current !== authToken) return;
      setHistory(body.matches);
      setHistoryError('');
    } catch {
      if (tokenRef.current === authToken)
        setHistoryError('Could not refresh match history. Retrying automatically.');
    }
  }

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
          void loadHistory(tokenRef.current);
          void refreshPlayer(tokenRef.current).catch(() => undefined);
          void loadLeaderboard().catch(() => undefined);
        }
      },
    });
    embedRef.current = controller;
    controller.send({ type: 'host_ready', protocolVersion: '1.0.0' });
    controller.sendSession(tokenRef.current, playerRef.current?.id);
  }

  async function applySession(authToken: string, epoch = sessionEpoch.current) {
    if (epoch !== sessionEpoch.current) return false;
    if (tokenRef.current !== authToken) setPlayer(null);
    storeToken(authToken);
    setToken(authToken);
    tokenRef.current = authToken;
    const loaded = await refreshPlayer(authToken, epoch);
    return loaded;
  }

  async function refreshPlayer(authToken: string, epoch = sessionEpoch.current): Promise<boolean> {
    if (!authToken) return false;
    const playerRes = await request(`${API_URL}/players/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (playerRes.status === 401 || playerRes.status === 403) return false;
    if (!playerRes.ok) throw new Error('Your account is temporarily unavailable.');
    const latest = (await playerRes.json()) as Player;
    if (tokenRef.current !== authToken || epoch !== sessionEpoch.current) return false;
    setPlayer(latest);
    return true;
  }

  async function loadCatalog() {
    setCatalogLoading(true);
    let guestsOn = false;
    let catalogOk = false;
    await Promise.allSettled([
      request(`${API_URL}/games`).then(async (res) => {
        if (!res.ok) throw new Error('Catalog unavailable');
        const body = (await res.json()) as { games: GameCard[] };
        setGames(
          body.games.map((game) => ({
            ...game,
            clientUrl:
              (game.slug === 'penalty-duel'
                ? process.env.NEXT_PUBLIC_GAME_PENALTY_URL
                : game.slug === 'rock-paper-scissors'
                  ? process.env.NEXT_PUBLIC_GAME_RPS_URL
                  : undefined) || game.clientUrl,
          })),
        );
        catalogOk = true;
      }),
      request(`${API_URL}/auth/config`).then(async (res) => {
        if (!res.ok) return;
        const config = (await res.json()) as { guestAuthEnabled: boolean };
        guestsOn = config.guestAuthEnabled;
        setGuestAvailable(guestsOn);
      }),
    ]);
    setCatalogLoading(false);
    setConnection(catalogOk ? 'online' : 'offline');
    return guestsOn;
  }

  async function loadLeaderboard() {
    const res = await request(`${API_URL}/stats/leaderboard?period=weekly`);
    if (!res.ok) return;
    const body = (await res.json()) as { boards: LeaderboardBoard[] };
    setBoards(body.boards);
  }

  async function probeGuest(epoch = sessionEpoch.current): Promise<boolean> {
    const res = await request(`${API_URL}/auth/guest`, { method: 'POST' });
    if (!res.ok) return false;
    const guest = (await res.json()) as { token: string };
    return applySession(guest.token, epoch);
  }

  async function bootstrap() {
    if (bootstrapBusy.current) return;
    bootstrapBusy.current = true;
    const epoch = sessionEpoch.current;
    // Public artwork/catalog render independently of authentication and rankings.
    const catalog = loadCatalog();
    void loadLeaderboard().catch(() => undefined);
    try {
      const stored = readStoredToken();
      if (stored && (await applySession(stored, epoch))) return;
      if (epoch !== sessionEpoch.current) return;
      if (stored) {
        clearStoredToken();
        setToken('');
        setPlayer(null);
        tokenRef.current = '';
      }
      if ((await catalog) && epoch === sessionEpoch.current) await probeGuest(epoch);
    } catch {
      // A timeout or 5xx is not an invalid session. Keep it for the next retry.
      await catalog;
      if (epoch === sessionEpoch.current) setConnection('offline');
    } finally {
      await catalog;
      bootstrapBusy.current = false;
    }
  }

  useEffect(() => {
    const recover = () => {
      if (document.visibilityState === 'visible') void bootstrap();
    };
    const offline = () => setConnection('offline');
    const visible = () => {
      if (connection === 'offline') recover();
    };
    window.addEventListener('online', recover);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const timer = connection === 'offline' ? window.setInterval(recover, 15000) : undefined;
    return () => {
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(timer);
    };
  }, [connection]);

  function navigate(next: LobbyView) {
    if (activeGame) closeGame();
    focusAfterNavigation.current = true;
    setView(next);
    if (next === 'history' && token) void loadHistory(token);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  useEffect(() => {
    if (!focusAfterNavigation.current || activeGame) return;
    focusAfterNavigation.current = false;
    const heading = document.querySelector<HTMLElement>(
      '.page-content section:not([hidden]) h1, .page-content section:not([hidden]) h2',
    );
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }, [view, activeGame]);

  async function createGuest() {
    const epoch = ++sessionEpoch.current;
    setAuthError('');
    setAuthBusy(true);
    try {
      const ok = await probeGuest(epoch);
      if (epoch !== sessionEpoch.current) return;
      if (!ok) {
        setAuthError('Guest play is disabled. Create an account to continue.');
      }
    } catch {
      if (epoch === sessionEpoch.current) setAuthError('Could not create a guest session.');
    } finally {
      if (epoch === sessionEpoch.current) setAuthBusy(false);
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const epoch = ++sessionEpoch.current;
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
      const res = await request(`${API_URL}${path}`, {
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
      if (epoch !== sessionEpoch.current) return;
      if (!res.ok || !tokenValue) {
        setAuthError(apiErrorMessage(body, 'Authentication failed'));
        return;
      }
      if (!(await applySession(tokenValue, epoch))) return;
      void loadLeaderboard().catch(() => undefined);
      if (epoch !== sessionEpoch.current) return;
      setAuthMode('login');
      setView('home');
    } catch {
      if (epoch === sessionEpoch.current) setAuthError('Could not reach the API.');
    } finally {
      if (epoch === sessionEpoch.current) setAuthBusy(false);
    }
  }

  async function logout() {
    const previousToken = tokenRef.current;
    ++sessionEpoch.current;
    clearStoredToken();
    closeGame();
    setToken('');
    tokenRef.current = '';
    setHistory([]);
    setPlayer(null);
    setAuthBusy(false);
    setAuthMode('login');
    if (previousToken) {
      await request(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${previousToken}` },
      }).catch(() => undefined);
    }
  }

  function openGame(game: GameCard) {
    try {
      sessionStorage.setItem('kampi.activeGame', game.slug);
    } catch {
      /* optional storage */
    }
    setEmbedMessage('');
    const url = new URL(game.clientUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    url.searchParams.set('v', Date.now().toString());
    setActiveGame({ ...game, clientUrl: url.toString() });
  }

  function closeGame() {
    try {
      sessionStorage.removeItem('kampi.activeGame');
    } catch {
      /* optional storage */
    }
    if (token) void loadHistory(token);
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
      <LobbyHeader balance={player?.balance ?? null} onNavigate={navigate} />

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
              key={activeGame.clientUrl}
              className="game-frame"
              src={activeGame.clientUrl}
              title={activeGame.name}
              allow="fullscreen"
              onLoad={connectFrame}
              referrerPolicy="origin"
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
          <div className="page-content">
            <section
              className="account-panel"
              hidden={view !== 'account'}
              aria-label="Your account"
            >
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

            {view === 'home' && (
              <LobbyHome
                games={games}
                boards={boards}
                connection={connection}
                loading={catalogLoading}
                onPlay={(game) => (player ? openGame(game) : navigate('account'))}
                onRewards={() => navigate('rewards')}
                onRankings={() => navigate('rankings')}
                onRetry={() => {
                  setConnection('checking');
                  void bootstrap();
                }}
              />
            )}

            {view === 'rewards' && (
              <section className="rewards-page" aria-labelledby="rewards-heading">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">EVERY DUEL COUNTS</span>
                    <h2 id="rewards-heading">Your rewards</h2>
                  </div>
                  <img src="/art/lobby/reward-badge-112.webp" width="112" height="122" alt="" />
                </div>
                <p className="muted">
                  Keep playing. Earn XP from completed duels and grow your game level.
                </p>
                <div className="reward-summary">
                  <div>
                    <span>YOUR LEVEL</span>
                    <strong>{stats.level}</strong>
                  </div>
                  <div>
                    <span>TOTAL XP</span>
                    <strong>{stats.xp.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>DUELS WON</span>
                    <strong>{stats.wins}</strong>
                  </div>
                </div>
                <div className="grid-2">
                  {stats.games.length ? (
                    stats.games.map((game) => (
                      <ProgressionCard key={game.gameSlug} stats={stats} game={game} />
                    ))
                  ) : (
                    <p className="empty-state">
                      Your first duel starts your progression. Pick a game and make your move.
                    </p>
                  )}
                </div>
                <button
                  className="reward-button"
                  onClick={() => navigate(player ? 'home' : 'account')}
                >
                  {player ? 'Find your next duel' : 'Sign in to start'}
                </button>
              </section>
            )}
            {view === 'shop' && (
              <section className="card shop-page" aria-labelledby="shop-heading">
                <img src="/art/lobby/coin-78.webp" width="78" height="78" alt="" />
                <span className="eyebrow">SOMETHING GOOD IS ON THE WAY</span>
                <h2 id="shop-heading">The Kampi shop</h2>
                <p>
                  The shop is coming soon. For now, take your chips into the arena and play for the
                  win.
                </p>
                {player && (
                  <p className="shop-balance">
                    Your balance <strong>{BigInt(player.balance).toLocaleString()} chips</strong>
                  </p>
                )}
                <button className="reward-button" onClick={() => navigate('home')}>
                  Back to battle <span aria-hidden="true">↗</span>
                </button>
              </section>
            )}

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
            <section
              className="card match-history"
              hidden={view !== 'history'}
              aria-label="Previous matches"
            >
              <div className="section-heading">
                <h2>Previous matches</h2>
                <button
                  className="ghost-button"
                  disabled={!token}
                  onClick={() => void loadHistory(token)}
                >
                  Refresh
                </button>
              </div>
              <p className="muted">
                Your latest duels, scores and results. Updated after every match.
              </p>
              {historyError ? <p role="status">{historyError}</p> : null}
              {!player ? (
                <p>Sign in to see your matches.</p>
              ) : history.length === 0 ? (
                <p>No matches yet. Your first duel will appear here.</p>
              ) : (
                <ol className="history-list">
                  {history.map((match) => (
                    <li key={match.matchId}>
                      <div>
                        <strong>{match.gameName}</strong>
                        <span>
                          vs {match.opponent}
                          {match.botFill ? ' · BOT' : ''}
                        </span>
                        <time dateTime={match.createdAt}>
                          {new Date(match.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </div>
                      <div className="history-result">
                        <strong>
                          {match.score} – {match.opponentScore}
                        </strong>
                        <span data-result={match.result}>
                          {match.result ??
                            (match.status === 'FINISHED'
                              ? 'Updating result…'
                              : match.status === 'ABORTED'
                                ? 'Cancelled'
                                : 'In progress')}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {view !== 'home' && <p className="lobby-note">Virtual chips only · No cash-out</p>}
          </div>
          <LobbyNavigation view={view} onNavigate={navigate} />
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
      <h2>{game?.gameName ?? 'Progression'}</h2>
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
