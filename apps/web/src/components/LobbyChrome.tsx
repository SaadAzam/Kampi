'use client';

import { useEffect, useRef } from 'react';

export type LobbyView = 'home' | 'rankings' | 'history' | 'account' | 'rewards' | 'shop';
const ART = '/art/lobby';

export function LobbyHeader({
  balance,
  onNavigate,
}: {
  balance: string | null;
  onNavigate: (view: LobbyView) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(
    () => () => {
      document.body.style.overflow = '';
    },
    [],
  );
  function closeMenu() {
    dialog.current?.close();
    document.body.style.overflow = '';
  }
  function navigate(view: LobbyView) {
    closeMenu();
    onNavigate(view);
  }
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <button
            className="menu-button"
            aria-label="Open menu"
            aria-haspopup="dialog"
            onClick={() => {
              dialog.current?.showModal();
              document.body.style.overflow = 'hidden';
            }}
          >
            <span />
            <span />
            <span />
          </button>
          <button className="brand" onClick={() => onNavigate('home')} aria-label="Kampi home">
            <img
              src={`${ART}/logo-247.webp`}
              width="247"
              height="45"
              alt="Kampi.fun"
              fetchPriority="high"
            />
          </button>
          <button
            className="wallet-pill"
            onClick={() => onNavigate('account')}
            aria-label={
              balance === null
                ? 'Sign in to view your balance'
                : `Balance: ${BigInt(balance).toLocaleString()} chips. Open profile`
            }
          >
            <span>{balance === null ? 'Sign in' : BigInt(balance).toLocaleString()}</span>
          </button>
        </div>
      </header>
      <dialog
        className="menu-dialog"
        ref={dialog}
        onClose={() => {
          document.body.style.overflow = '';
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const buttons =
            dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        aria-labelledby="menu-title"
      >
        <div className="menu-content">
          <div className="section-heading">
            <h2 id="menu-title">Your arena</h2>
            <button className="close-button" onClick={closeMenu} aria-label="Close menu">
              ×
            </button>
          </div>
          <p className="muted">A little rivalry. A lot of fun.</p>
          {(
            [
              ['home', 'Battle', 'Find your next duel'],
              ['rankings', 'Leaderboards', 'This week’s top players'],
              ['history', 'Previous matches', 'Every score. Every result.'],
              ['rewards', 'Rewards', 'Your XP and progression'],
              ['account', 'Profile', 'Your account and balance'],
              ['shop', 'Shop', 'The next chapter'],
            ] as const
          ).map(([view, label, detail]) => (
            <button
              className="menu-link"
              aria-label={label}
              key={view}
              onClick={() => navigate(view)}
            >
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
          <p className="menu-footnote">Virtual chips. Real competition.</p>
        </div>
      </dialog>
    </>
  );
}

export function LobbyNavigation({
  view,
  onNavigate,
}: {
  view: LobbyView;
  onNavigate: (view: LobbyView) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <div className="nav-rail" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="nav-inner">
        {(
          [
            ['account', 'Edit', 'edit'],
            ['rankings', 'Leaderboards', 'leaderboards'],
            ['home', 'Battle', 'battle'],
            ['shop', 'Shop', 'shop'],
            ['account', 'Profile', 'profile'],
          ] as const
        ).map(([target, label, icon]) => (
          <button
            key={label}
            className={`nav-item ${target === 'home' ? 'nav-battle' : ''}`}
            aria-label={label}
            aria-current={view === target && label !== 'Edit' ? 'page' : undefined}
            onClick={() => onNavigate(target)}
          >
            <span className="nav-icon">
              <img
                src={`${ART}/nav-labeled-${icon}-v1-${target === 'home' ? '156' : '115'}.webp`}
                width={target === 'home' ? 156 : 115}
                height={target === 'home' ? 164 : 77}
                alt=""
              />
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
