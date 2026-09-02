'use client';

import { useEffect, useRef, useState } from 'react';
import { HostEmbedController } from '@kampi/game-sdk/embed';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Player = {
  id: string;
  displayName: string;
  balance: string;
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

export default function HomePage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [token, setToken] = useState('');
  const [games, setGames] = useState<GameCard[]>([]);
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking');
  const [activeGame, setActiveGame] = useState<GameCard | null>(null);
  const [embedMessage, setEmbedMessage] = useState('');
  const embedRef = useRef<HostEmbedController | null>(null);
  const playerRef = useRef(player);
  const tokenRef = useRef(token);

  playerRef.current = player;
  tokenRef.current = token;

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!activeGame || !tokenRef.current) return;

    const timer = window.setTimeout(() => {
      const iframe = document.getElementById('game-frame') as HTMLIFrameElement | null;
      if (!iframe?.contentWindow || !tokenRef.current) return;

      embedRef.current?.destroy();
      const origin = new URL(activeGame.clientUrl).origin;
      const controller = new HostEmbedController({
        targetWindow: iframe.contentWindow,
        targetOrigin: origin,
        allowedOrigins: [origin],
        onMessage: (message) => {
          setEmbedMessage(
            `${message.type}${'matchId' in message ? `: ${message.matchId}` : ''}`,
          );
          if (message.type === 'balance_changed') void bootstrap();
        },
      });
      embedRef.current = controller;
      controller.send({ type: 'host_ready', protocolVersion: '1.0.0' });
      controller.sendSession(tokenRef.current, playerRef.current?.id);
    }, 600);

    return () => {
      window.clearTimeout(timer);
      embedRef.current?.destroy();
      embedRef.current = null;
    };
  }, [activeGame]);

  async function bootstrap() {
    try {
      const guestRes = await fetch(`${API_URL}/auth/guest`, { method: 'POST' });
      let authToken = '';
      if (guestRes.ok) {
        const guest = (await guestRes.json()) as { token: string };
        authToken = guest.token;
        setToken(authToken);
      } else {
        authToken = 'dev-guest-token-kampi-local-only';
        setToken(authToken);
      }

      const [playerRes, gamesRes, healthRes] = await Promise.all([
        fetch(`${API_URL}/players/me`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${API_URL}/games`),
        fetch(`${API_URL}/health/live`),
      ]);

      if (playerRes.ok) setPlayer(await playerRes.json());
      if (gamesRes.ok) {
        const body = (await gamesRes.json()) as { games: GameCard[] };
        setGames(body.games);
      }
      setConnection(healthRes.ok ? 'online' : 'offline');
    } catch {
      setConnection('offline');
    }
  }

  function openGame(game: GameCard) {
    setEmbedMessage('');
    setActiveGame(game);
  }

  function closeGame() {
    embedRef.current?.destroy();
    embedRef.current = null;
    setActiveGame(null);
    setEmbedMessage('');
    void bootstrap();
  }

  return (
    <main className="app-shell">
      <header className="header">
        <h1>Kampi.fun</h1>
        <p>Mobile-first 1v1 games — prototype shell</p>
        <span className="status-pill">API: {connection}</span>
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
              <button type="button" className="ghost-button" onClick={() => void bootstrap()}>
                Refresh identity
              </button>
            </div>
            <div className="card sidebar-card">
              <h2>Progression</h2>
              <p>Placeholder — levels & XP coming soon</p>
            </div>
          </aside>
        </section>
      ) : (
        <>
          <nav className="nav" aria-label="Primary">
            <strong>Lobby</strong>
            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="card">
                <h2>Player</h2>
                <p>{player?.displayName ?? 'Guest'}</p>
                <p>Balance: {player?.balance ?? '…'} chips</p>
                <button type="button" onClick={() => void bootstrap()} style={{ marginTop: 8 }}>
                  New guest identity
                </button>
              </div>
              <div className="card">
                <h2>Progression</h2>
                <p>Placeholder — levels & XP coming soon</p>
              </div>
            </div>
          </nav>

          <section className="card">
            <h2>Games</h2>
            <div className="grid-2" style={{ marginTop: 12 }}>
              {games.map((game) => (
                <article key={game.id}>
                  <h3>{game.name}</h3>
                  <p>{game.description}</p>
                  <p>
                    Entry {game.entryFee} · Win {game.winnerPayout}
                  </p>
                  <button type="button" onClick={() => openGame(game)} style={{ marginTop: 8 }}>
                    Play {game.name}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Leaderboard</h2>
            <p>Placeholder — weekly leaderboard coming soon</p>
          </section>
        </>
      )}
    </main>
  );
}
