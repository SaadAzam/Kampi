'use client';

import { useEffect, useState } from 'react';
import { HostEmbedController } from '@kampi/game-sdk';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const GAME_URL = process.env.NEXT_PUBLIC_GAME_RPS_URL ?? 'http://localhost:5173';
const AUTH_TOKEN = 'dev-guest-token-kampi-local-only';

type Player = {
  id: string;
  displayName: string;
  balance: string;
};

type GameConfig = {
  slug: string;
  name: string;
  entryFee: string;
  winnerPayout: string;
  bestOf: number;
  botFillAfterMs: number;
};

export default function HomePage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [game, setGame] = useState<GameConfig | null>(null);
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking');
  const [showGame, setShowGame] = useState(false);
  const [embedMessage, setEmbedMessage] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      const [playerRes, gameRes, healthRes] = await Promise.all([
        fetch(`${API_URL}/players/me`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        }),
        fetch(`${API_URL}/games/rock-paper-scissors/config`),
        fetch(`${API_URL}/health/live`),
      ]);

      if (playerRes.ok) setPlayer(await playerRes.json());
      if (gameRes.ok) setGame(await gameRes.json());
      setConnection(healthRes.ok ? 'online' : 'offline');
    } catch {
      setConnection('offline');
    }
  }

  function openGame() {
    setShowGame(true);
    setTimeout(() => {
      const iframe = document.getElementById('rps-frame') as HTMLIFrameElement | null;
      if (!iframe?.contentWindow) return;
      const controller = new HostEmbedController({
        targetWindow: iframe.contentWindow,
        targetOrigin: new URL(GAME_URL).origin,
        allowedOrigins: [new URL(GAME_URL).origin],
        onMessage: (message) => {
          setEmbedMessage(`${message.type}${'matchId' in message ? `: ${message.matchId}` : ''}`);
          if (message.type === 'balance_changed') void loadData();
        },
      });
      controller.sendSession(AUTH_TOKEN, player?.id);
    }, 500);
  }

  return (
    <main className="app-shell">
      <header className="header">
        <h1>Kampi.fun</h1>
        <p>Mobile-first 1v1 games — prototype shell</p>
        <span className="status-pill">API: {connection}</span>
      </header>

      <nav className="nav" aria-label="Primary">
        <strong>Lobby</strong>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div className="card">
            <h2>Player</h2>
            <p>{player?.displayName ?? 'Dev Player'}</p>
            <p>Balance: {player?.balance ?? '…'} chips</p>
          </div>
          <div className="card">
            <h2>Progression</h2>
            <p>Placeholder — levels & XP coming soon</p>
          </div>
        </div>
      </nav>

      <section className="card">
        <h2>Games</h2>
        {game ? (
          <article style={{ marginTop: 12 }}>
            <h3>{game.name}</h3>
            <p>
              Entry {game.entryFee} · Win {game.winnerPayout} · Best of {game.bestOf}
            </p>
            <p>Bot fills after {Math.round(game.botFillAfterMs / 1000)}s</p>
            <button type="button" onClick={openGame} style={{ marginTop: 8 }}>
              Play RPS
            </button>
          </article>
        ) : (
          <p>Loading game config…</p>
        )}
      </section>

      <section className="card">
        <h2>Leaderboard</h2>
        <p>Placeholder — weekly leaderboard coming soon</p>
      </section>

      {showGame ? (
        <section className="card">
          <h2>Rock Paper Scissors</h2>
          {embedMessage ? <p>Embed: {embedMessage}</p> : null}
          <iframe
            id="rps-frame"
            className="game-frame"
            src={`${GAME_URL}?token=${encodeURIComponent(AUTH_TOKEN)}`}
            title="Rock Paper Scissors"
            allow="fullscreen"
          />
        </section>
      ) : null}
    </main>
  );
}
