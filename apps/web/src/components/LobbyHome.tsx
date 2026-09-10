'use client';

import type { CSSProperties } from 'react';

const ART = '/art/lobby';
const CARD_SIZES =
  '(max-width: 359px) 92vw, (max-width: 700px) 46vw, (max-width: 1100px) 44vw, 460px';
export type LobbyGame = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  clientUrl: string;
  entryFee: string;
  winnerPayout: string;
};
export type LobbyBoard = {
  gameSlug: string;
  gameName: string;
  periodKey: string;
  entries: Array<{ rank: number; userId: string; displayName: string; score: number }>;
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function LobbyHome({
  games,
  boards,
  connection,
  loading,
  playerReady,
  onPlay,
  onRewards,
  onRankings,
  onRetry,
}: {
  games: LobbyGame[];
  boards: LobbyBoard[];
  connection: 'checking' | 'online' | 'offline';
  loading: boolean;
  playerReady: boolean;
  onPlay: (game: LobbyGame) => void;
  onRewards: () => void;
  onRankings: () => void;
  onRetry: () => void;
}) {
  const leaders = boards
    .flatMap((board) =>
      board.entries
        .slice(0, 3)
        .map((entry) => ({ ...entry, gameName: board.gameName, gameSlug: board.gameSlug })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const sortedGames = [...games].sort(
    (a, b) => Number(b.slug === 'penalty-duel') - Number(a.slug === 'penalty-duel'),
  );
  return (
    <section className="lobby-home" aria-label="Game lobby">
      <h1 className="sr-only">Kampi — your next duel starts here</h1>
      <div className="rewards-banner">
        <div className="banner-glint" aria-hidden="true" />
        <div className="rewards-copy">
          <p className="rewards-title">
            KAMPI <span>REWARDS</span>
          </p>
          <p className="rewards-description">Play duels. Earn XP. Rise through the ranks.</p>
          <button className="reward-button" onClick={onRewards}>
            View rewards <span aria-hidden="true">↗</span>
          </button>
        </div>
        <img
          className="rewards-crest"
          src={`${ART}/reward-badge-223.webp`}
          width="223"
          height="243"
          alt="Golden Kampi reward crest"
          fetchPriority="high"
        />
      </div>

      <div className="leaders-heading">
        <span>
          <span className="small-star" aria-hidden="true">
            ✦
          </span>{' '}
          THE WEEK’S CONTENDERS
        </span>
        <button onClick={onRankings}>
          Leaderboard <span aria-hidden="true">↗</span>
        </button>
      </div>
      {leaders.length ? (
        <div className="contender-strip" aria-label="Weekly top players">
          {leaders.map((entry, index) => (
            <button
              key={`${entry.gameSlug}-${entry.userId}`}
              className={`contender contender-${index % 3}`}
              onClick={onRankings}
              style={{ '--item-index': index } as CSSProperties}
            >
              <span className="contender-avatar" aria-hidden="true">
                {initials(entry.displayName)}
              </span>
              <span className="contender-name">
                <strong title={entry.displayName}>{entry.displayName}</strong>
                <small>{entry.gameName}</small>
              </span>
              <span className="contender-score" title="Wins this week">
                <span aria-hidden="true">★</span> {entry.score}
                <span className="sr-only"> wins this week</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="contenders-empty">
          <span className="small-star" aria-hidden="true">
            ✦
          </span>
          <span>
            {loading
              ? 'Finding this week’s contenders…'
              : 'A fresh rivalry starts with you. Win a duel to join the leaderboard.'}
          </span>
        </div>
      )}

      <div className="arena-heading">
        <div>
          <span className="eyebrow">PICK YOUR GAME</span>
          <h2>
            Enter the arena<span>.</span>
          </h2>
        </div>
        <span className="arena-status" role="status">
          <i className={connection === 'online' ? 'online-dot' : 'offline-dot'} />
          {connection === 'online'
            ? 'Arena online'
            : connection === 'checking'
              ? 'Connecting'
              : 'Reconnecting'}
        </span>
      </div>
      {connection === 'offline' && (
        <div className="connection-notice" role="status">
          <span>The arena is taking a moment to reconnect.</span>
          <button onClick={onRetry}>Try again</button>
        </div>
      )}
      <div className="game-grid" aria-busy={loading}>
        {sortedGames.map((game, index) => {
          const penalty = game.slug === 'penalty-duel';
          const art = penalty ? 'penalty-action' : 'rps';
          const widths = penalty ? [240, 384] : [320, 640, 960];
          const sourceSet = (format: 'avif' | 'webp') =>
            widths.map((width) => `${ART}/${art}-${width}.${format} ${width}w`).join(', ');
          const large = penalty ? 384 : 640;
          return (
            <article
              key={game.id}
              className={`game-card ${penalty ? 'penalty-card' : 'rps-card'}`}
              style={{ '--item-index': index } as CSSProperties}
            >
              <div className="game-art">
                <picture>
                  {penalty && (
                    <source
                      media="(min-width: 701px), (min-resolution: 2.5dppx)"
                      type="image/avif"
                      srcSet={`${ART}/penalty-desktop-768.avif 768w, ${ART}/penalty-desktop-1152.avif 1152w`}
                      sizes={CARD_SIZES}
                    />
                  )}
                  {penalty && (
                    <source
                      media="(min-width: 701px), (min-resolution: 2.5dppx)"
                      type="image/webp"
                      srcSet={`${ART}/penalty-desktop-768.webp 768w, ${ART}/penalty-desktop-1152.webp 1152w`}
                      sizes={CARD_SIZES}
                    />
                  )}
                  <source type="image/avif" srcSet={sourceSet('avif')} sizes={CARD_SIZES} />
                  <img
                    src={`${ART}/${art}-${large}.webp`}
                    srcSet={sourceSet('webp')}
                    sizes={CARD_SIZES}
                    width="640"
                    height="384"
                    alt={
                      penalty
                        ? 'Goalkeeper diving to save a blazing football'
                        : 'Rock, paper and scissors face off in a neon arena'
                    }
                    fetchPriority={index === 0 ? 'high' : 'auto'}
                    decoding="async"
                  />
                </picture>
                <span className="game-badge">
                  <span aria-hidden="true">{penalty ? '✦' : '◆'}</span>{' '}
                  {penalty ? 'FAN FAVOURITE' : 'THE ORIGINAL DUEL'}
                </span>
                <span className="game-mode">
                  1 <span>vs</span> 1
                </span>
              </div>
              <div className="game-card-body">
                <div className="game-title-row">
                  <h3>{game.name}</h3>
                  <span className="card-arrow" aria-hidden="true">
                    ↗
                  </span>
                </div>
                <p className="game-description">
                  {penalty
                    ? 'Hold your nerve. Take the winning shot.'
                    : 'Read your rival. Make your move.'}
                </p>
                <div className="game-card-bottom">
                  <div className="game-economy">
                    <img src={`${ART}/coin-40.webp`} width="28" height="28" alt="" />
                    <div>
                      <strong>
                        {BigInt(game.entryFee).toLocaleString()} <span>entry</span>
                      </strong>
                      <small>Win {BigInt(game.winnerPayout).toLocaleString()} chips</small>
                    </div>
                  </div>
                  <button
                    className="play-button"
                    aria-label={`Play ${game.name}`}
                    onClick={() => onPlay(game)}
                    disabled={connection === 'offline'}
                  >
                    Play <span aria-hidden="true">▸</span>
                  </button>
                </div>
              </div>
              <div className="card-underglow" aria-hidden="true" />
            </article>
          );
        })}
        {loading &&
          games.length === 0 &&
          [0, 1].map((index) => (
            <div key={index} className="game-card game-skeleton" aria-hidden="true">
              <div className="skeleton-art" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ))}
      </div>
      {!loading && games.length === 0 && connection === 'online' && (
        <div className="empty-state">The next games are warming up. Check back shortly.</div>
      )}
      <div className="lobby-footer">
        <span className="footer-mark" aria-hidden="true">
          ✦
        </span>
        <p>
          One opponent. One moment. <strong>Make it yours.</strong>
        </p>
        <span>
          {playerReady
            ? 'Your progress is saved after every duel.'
            : 'Jump in as a guest or sign in to keep your progress.'}
        </span>
      </div>
    </section>
  );
}
