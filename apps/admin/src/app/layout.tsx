import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kampi Admin',
  description: 'Kampi operations dashboard',
};

const links = [
  { href: '/', label: 'Overview' },
  { href: '/audit', label: 'Audit trail' },
  { href: '/players', label: 'Players' },
  { href: '/matches', label: 'Matches' },
  { href: '/wallet', label: 'Wallet Ledger' },
  { href: '/games', label: 'Games' },
  { href: '/health', label: 'System Health' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <h1>Kampi Admin</h1>
            <p className="muted">Live operations · Restricted access</p>
            <nav>
              {links.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
