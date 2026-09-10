'use client';

import { useState, type CSSProperties } from 'react';

const ART = '/art/lobby';
const CARD_SIZES = '(max-width: 700px) 44vw, (max-width: 1099px) 44vw, 300px';
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
  onPlay,
  onRewards,
  onRankings,
  onRetry,
}: {
  games: LobbyGame[];
  boards: LobbyBoard[];
  connection: 'checking' | 'online' | 'offline';
  loading: boolean;
  onPlay: (game: LobbyGame) => void;
  onRewards: () => void;
  onRankings: () => void;
  onRetry: () => void;
}) {
  const leaders = boards
    .flatMap((board) =>
      board.entries
        .slice(0, 20)
        .map((entry) => ({ ...entry, gameName: board.gameName, gameSlug: board.gameSlug })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
  const [tickerPaused, setTickerPaused] = useState(false);
  // Each half is wider than the largest lobby viewport, even for a short live board.
  const loopEntries = leaders.length
    ? Array.from({ length: Math.ceil(8 / leaders.length) }, () => leaders).flat()
    : [];
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
          <p className="rewards-description">FREE MISSION EARN REWARDS</p>
          <button className="reward-button" onClick={onRewards} aria-label="View rewards">
            <img src={`${ART}/slice-reward-button-v2-247.webp`} width="247" height="57" alt="" />
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

      {leaders.length ? (
        <div
          className="contender-strip"
          aria-label="Weekly top players"
          data-paused={tickerPaused}
          style={{ '--loop-count': loopEntries.length } as CSSProperties}
        >
          <div className="contender-viewport">
            <div className="contender-track">
              {[0, 1].map((copy) => (
                <div className="contender-group" key={copy} aria-hidden={copy === 1 || undefined}>
                  {loopEntries.map((entry, index) => {
                    const duplicate = copy === 1 || index >= leaders.length;
                    return (
                      <button
                        key={`${index}-${entry.gameSlug}-${entry.userId}`}
                        className={`contender contender-${index % 3}${duplicate ? ' contender-duplicate' : ''}`}
                        onClick={onRankings}
                        tabIndex={duplicate ? -1 : undefined}
                        aria-hidden={duplicate || undefined}
                        onPointerDown={duplicate ? (event) => event.preventDefault() : undefined}
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
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <button
            className="ticker-toggle"
            aria-label={tickerPaused ? 'Resume player strip' : 'Pause player strip'}
            aria-pressed={tickerPaused}
            onClick={() => setTickerPaused((paused) => !paused)}
          >
            <span aria-hidden="true">{tickerPaused ? '▶' : 'Ⅱ'}</span>
          </button>
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

      <h2 className="sr-only">Choose your game</h2>
      {connection === 'offline' && (
        <div className="connection-notice" role="status">
          <span>The arena is taking a moment to reconnect.</span>
          <button onClick={onRetry}>Try again</button>
        </div>
      )}
      <div
        className="game-grid"
        aria-busy={loading}
        style={{ '--game-columns': Math.min(sortedGames.length || 2, 4) } as CSSProperties}
      >
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
              </div>
              <div className="game-card-body">
                <div className="game-card-details">
                  <h3>{game.name}</h3>
                  <div className="game-economy">
                    <img src={`${ART}/coin-40.webp`} width="28" height="28" alt="" />
                    <span
                      aria-label={`${BigInt(game.entryFee).toLocaleString()} chips entry. Win ${BigInt(game.winnerPayout).toLocaleString()} chips`}
                    >
                      {BigInt(game.entryFee).toLocaleString()}
                      <span className="sr-only"> chips </span>
                      <span className="entry-label" aria-hidden="true">
                        {' '}
                        entry
                      </span>
                    </span>
                  </div>
                </div>
              </div>
              <button
                className="play-button"
                aria-label={`Play ${game.name}`}
                onClick={() => onPlay(game)}
                disabled={connection === 'offline'}
              >
                <img src={`${ART}/slice-play-button-v2-157.webp`} width="157" height="71" alt="" />
              </button>
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
    </section>
  );
}
