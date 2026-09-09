'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

type Player = {
  id: string;
  displayName: string;
  email: string | null;
  status: string;
  isGuest: boolean;
  createdAt: string;
  wallet?: { balance: string };
  progression?: {
    xp: number;
    wins: number;
    losses: number;
    level: number;
    game: { name: string };
  }[];
};
type Row = {
  id: string;
  name?: string;
  slug?: string;
  status?: string;
  createdAt: string;
  finalizedAt?: string;
  botFill?: boolean;
  entryFee?: string;
  winnerPayout?: string;
  game?: { name: string };
  players?: { displayName: string; score: number; result: string | null }[];
  type?: string;
  amount?: string;
  balanceAfter?: string;
  idempotencyKey?: string;
  matchId?: string;
  metadata?: unknown;
  payload?: unknown;
  wallet?: { user: Player };
  actor?: Player;
  entityType?: string;
  entityId?: string;
  versions?: { version: string; isActive: boolean; config: unknown }[];
  _count?: { matches: number };
  events?: Row[];
  ledgerEntries?: Row[];
  service?: string;
};
type Overview = {
  players: number;
  guests: number;
  suspended: number;
  matches: number;
  matchesLast7Days: number;
  chipsInWallets: string;
  byStatus: { status: string; _count: number }[];
  byGame: { name: string; status: string; _count: { matches: number } }[];
  daily: { day: string; matches: string }[];
  ledger: { type: string; _count: number; _sum: { amount: string } }[];
  progression: { wins: number; losses: number; xp: number };
};
const titles: Record<string, string> = {
  overview: 'Overview',
  players: 'Players',
  matches: 'Matches',
  wallet: 'Wallet ledger',
  games: 'Games',
  health: 'System health',
  audit: 'Admin audit trail',
};
const date = (v?: string) => (v ? new Date(v).toLocaleString() : '—');
const number = (v?: string | number | null) => (v == null ? '0' : Number(v).toLocaleString());
async function api<T>(path: string, options?: Parameters<typeof fetch>[1]): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, { cache: 'no-store', ...options });
  const body = await res.json();
  if (!res.ok) {
    const error = new Error(body.message ?? body.error?.message ?? 'Request failed') as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  return body as T;
}

export default function AdminDashboard({ section = 'overview' }: { section?: string }) {
  const loadVersion = useRef(0);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [actor, setActor] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [updated, setUpdated] = useState('');
  const [detail, setDetail] = useState<Row>();
  const [action, setAction] = useState<{
    id: string;
    name: string;
    type: 'adjustment' | 'player' | 'game';
    status?: string;
    commandId: string;
  }>();
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      if (section === 'overview') {
        const data = await api<Overview>('overview');
        if (version !== loadVersion.current) return;
        setOverview(data);
      } else {
        const data = await api<{ items: Row[] & Player[]; total?: number }>(
          `${section}?page=${page}&search=${encodeURIComponent(filter)}`,
        );
        if (version !== loadVersion.current) return;
        if (section === 'players') setPlayers(data.items);
        else setRows(data.items);
        setTotal(data.total ?? data.items.length);
      }
      setUpdated(new Date().toLocaleTimeString());
      setError('');
    } catch (e) {
      if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 403)
        setAuthorized(false);
      setError((e as Error).message);
    }
  }, [section, page, filter]);
  useEffect(() => {
    void api<{ user: Player }>('me')
      .then((data) => {
        setActor(data.user.displayName);
        setAuthorized(true);
      })
      .catch(() => setAuthorized(false));
  }, []);
  useEffect(() => {
    if (!authorized) return;
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [authorized, load]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      const data = await api<{ user: Player }>('me');
      setActor(data.user.displayName);
      setAuthorized(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const path =
      action.type === 'game'
        ? `games/${action.id}/status`
        : `players/${action.id}/${action.type === 'player' ? 'status' : 'adjustment'}`;
    try {
      await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: form.get('reason'),
          ...(action.type === 'adjustment'
            ? { amount: form.get('amount'), commandId: action.commandId }
            : { status: action.status }),
        }),
      });
      setAction(undefined);
      setNotice('Change saved and recorded in the admin audit trail.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (authorized === null) return <div className="card">Checking your admin session…</div>;
  if (!authorized)
    return (
      <section className="card login">
        <span className="eyebrow">RESTRICTED ACCESS</span>
        <h2>Administrator sign in</h2>
        <p className="muted">Use your designated Kampi administrator account.</p>
        <form onSubmit={login}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
        </form>
      </section>
    );
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">KAMPI OPERATIONS</span>
          <h2>{titles[section]}</h2>
          <p className="muted">
            {actor} · {updated ? `Updated ${updated}` : 'Loading live data…'}
          </p>
        </div>
        <div className="tools">
          <button className="secondary" onClick={() => void load()}>
            Refresh
          </button>
          <button
            className="secondary"
            onClick={async () => {
              await fetch('/api/session', { method: 'DELETE' });
              setAuthorized(false);
              setRows([]);
              setPlayers([]);
              setOverview(undefined);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {section === 'overview' && overview && (
        <>
          <div className="metrics">
            {[
              ['Players', overview.players],
              ['Matches', overview.matches],
              ['Last 7 days', overview.matchesLast7Days],
              ['Chips in wallets', overview.chipsInWallets],
              ['Guest accounts', overview.guests],
              ['Suspended', overview.suspended],
              ['Player wins', overview.progression.wins],
              ['Total XP', overview.progression.xp],
            ].map(([label, value]) => (
              <article className="card metric" key={label}>
                <span>{label}</span>
                <strong>{number(value)}</strong>
              </article>
            ))}
          </div>
          <div className="two-columns">
            <section className="card">
              <h3>Match status</h3>
              {overview.byStatus.map((row) => (
                <p className="stat" key={row.status}>
                  <span>{row.status}</span>
                  <strong>{row._count}</strong>
                </p>
              ))}
            </section>
            <section className="card">
              <h3>Games</h3>
              {overview.byGame.map((row) => (
                <p className="stat" key={row.name}>
                  <span>
                    {row.name} <small>{row.status}</small>
                  </span>
                  <strong>{row._count.matches} matches</strong>
                </p>
              ))}
            </section>
          </div>
          <section className="card">
            <h3>Daily matches · UTC</h3>
            {overview.daily.map((row) => (
              <p className="stat" key={row.day}>
                <span>{row.day}</span>
                <strong>{row.matches}</strong>
              </p>
            ))}
            {!overview.daily.length && <p>No matches in the last seven days.</p>}
          </section>
          <section className="card">
            <h3>Ledger totals · virtual chips</h3>
            {overview.ledger.map((row) => (
              <p className="stat" key={row.type}>
                <span>
                  {row.type} <small>{row._count} entries</small>
                </span>
                <strong>{number(row._sum.amount)}</strong>
              </p>
            ))}
          </section>
        </>
      )}
      {['players', 'matches', 'wallet'].includes(section) && (
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setFilter(search);
          }}
        >
          <input
            aria-label="Search"
            placeholder={
              section === 'wallet'
                ? 'Player name, user ID, match ID or ledger key'
                : 'Search by name or ID'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button>Search</button>
        </form>
      )}
      {section === 'players' && (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Status</th>
                <th>Balance</th>
                <th>Progression</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.displayName}</strong>
                    <small>{p.email ?? 'Guest account'}</small>
                    <code>{p.id}</code>
                    <small>{date(p.createdAt)}</small>
                  </td>
                  <td>
                    <span className="badge">{p.status}</span>
                  </td>
                  <td>{number(p.wallet?.balance)}</td>
                  <td>
                    {p.progression?.map((g) => (
                      <small key={g.game.name}>
                        {g.game.name}: {g.wins}W / {g.losses}L · {g.xp} XP · Level {g.level}
                      </small>
                    ))}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="secondary"
                        onClick={() =>
                          setAction({
                            id: p.id,
                            name: p.displayName,
                            type: 'adjustment',
                            commandId: crypto.randomUUID(),
                          })
                        }
                      >
                        Adjust chips
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          setAction({
                            id: p.id,
                            name: p.displayName,
                            type: 'player',
                            status: p.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                            commandId: crypto.randomUUID(),
                          })
                        }
                      >
                        {p.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section === 'matches' && (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Match</th>
                <th>Players / score</th>
                <th>Status</th>
                <th>Economy</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.game?.name}</strong>
                    <code>{r.id}</code>
                    <small>
                      {date(r.createdAt)}
                      {r.botFill ? ' · BOT' : ''}
                    </small>
                  </td>
                  <td>
                    {r.players?.map((p, i) => (
                      <small key={i}>
                        {p.displayName}: <b>{p.score}</b> {p.result}
                      </small>
                    ))}
                  </td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td>
                    {r.entryFee} entry / {r.winnerPayout} payout
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() =>
                        void api<Row>(`matches/${r.id}`)
                          .then(setDetail)
                          .catch((e) => setError(e.message))
                      }
                    >
                      Timeline
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section === 'wallet' && (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Player / date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Balance after</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.wallet?.user.displayName}
                    <small>{date(r.createdAt)}</small>
                  </td>
                  <td>{r.type}</td>
                  <td className={Number(r.amount) > 0 ? 'positive' : ''}>{number(r.amount)}</td>
                  <td>{number(r.balanceAfter)}</td>
                  <td>
                    <code>{r.idempotencyKey}</code>
                    {r.matchId && <small>Match: {r.matchId}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section === 'games' && (
        <div className="two-columns">
          {rows.map((r) => (
            <section className="card" key={r.id}>
              <h3>{r.name}</h3>
              <p>
                <span className="badge">{r.status}</span> · {r._count?.matches} matches
              </p>
              {r.versions?.map((v) => (
                <details key={v.version}>
                  <summary>
                    Version {v.version}
                    {v.isActive ? ' · Active' : ''}
                  </summary>
                  <pre>{JSON.stringify(v.config, null, 2)}</pre>
                </details>
              ))}
              <p className="muted">
                Availability controls new matchmaking. Existing matches continue.
              </p>
              <button
                onClick={() =>
                  setAction({
                    id: r.id,
                    name: r.name ?? '',
                    type: 'game',
                    status: r.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE',
                    commandId: crypto.randomUUID(),
                  })
                }
              >
                {r.status === 'ACTIVE' ? 'Pause new matches' : 'Enable game'}
              </button>
            </section>
          ))}
        </div>
      )}
      {section === 'health' && (
        <div className="metrics">
          {rows.map((r) => (
            <section className="card metric" key={r.service}>
              <span>{r.service}</span>
              <strong>{r.status}</strong>
            </section>
          ))}
        </div>
      )}
      {section === 'audit' && (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Date / admin</th>
                <th>Target</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {date(r.createdAt)}
                    <small>{r.actor?.displayName}</small>
                  </td>
                  <td>
                    {r.entityType}
                    <code>{r.entityId}</code>
                  </td>
                  <td>
                    <pre>{JSON.stringify(r.metadata, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {['players', 'matches', 'wallet', 'audit'].includes(section) && (
        <div className="pagination">
          <span>
            {total} records · Page {page}
          </span>
          <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button
            className="secondary"
            disabled={page * 25 >= total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
      {detail && (
        <section className="card detail" aria-label="Match timeline">
          <button className="secondary" onClick={() => setDetail(undefined)}>
            Close timeline
          </button>
          <h3>
            {detail.game?.name} · {detail.status}
          </h3>
          <code>{detail.id}</code>
          <p>Finished: {date(detail.finalizedAt)}</p>
          <h4>Events (up to 500)</h4>
          {detail.events?.map((e) => (
            <details key={e.id}>
              <summary>
                {date(e.createdAt)} · {e.type}
              </summary>
              <pre>{JSON.stringify(e.payload, null, 2)}</pre>
            </details>
          ))}
          <h4>Settlement ledger</h4>
          <pre>{JSON.stringify(detail.ledgerEntries, null, 2)}</pre>
        </section>
      )}
      {action && (
        <div className="modal-backdrop">
          <section
            className="card modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-title"
          >
            <h3 id="action-title">
              {action.type === 'adjustment'
                ? 'Adjust chips'
                : action.status === 'ACTIVE'
                  ? 'Activate'
                  : 'Suspend / pause'}{' '}
              · {action.name}
            </h3>
            <p className="muted">
              This action is recorded with your administrator identity. Chip adjustments use an
              immutable ledger.
            </p>
            <form onSubmit={submitAction}>
              {action.type === 'adjustment' && (
                <label>
                  Chip change (negative to debit)
                  <input name="amount" inputMode="numeric" pattern="-?[1-9][0-9]{0,8}" required />
                </label>
              )}
              <label>
                Reason
                <input name="reason" minLength={5} maxLength={500} required />
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="tools">
                <button disabled={busy}>{busy ? 'Saving…' : 'Confirm change'}</button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setAction(undefined)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
