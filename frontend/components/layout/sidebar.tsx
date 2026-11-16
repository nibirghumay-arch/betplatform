'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useAuthStore } from '@/store/auth';
import { useBalance } from '@/hooks/useWallet';

const NAV = [
  { href: '/lobby', label: 'Game Lobby', icon: '🎮' },
  { href: '/wallet', label: 'Wallet', icon: '💳' },
  { href: '/profile', label: 'Profile', icon: '👤' },
];

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { data: balance } = useBalance();

  const handleLogout = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-white/10 bg-gradient-to-b from-[#171f39] via-[#11182e] to-[#0d1427] shadow-2xl shadow-black/20">
      {/* Logo */}
      <div className="flex h-20 items-center border-b border-white/10 px-6">
        <span className="bg-gradient-to-r from-amber-200 via-white to-cyan-200 bg-clip-text text-xl font-extrabold tracking-tight text-transparent">BetPlatform</span>
      </div>

      {/* Balance */}
      <div className="mx-4 mt-5 rounded-2xl border border-violet-300/20 bg-gradient-to-br from-violet-400/15 via-indigo-400/10 to-cyan-300/10 px-4 py-4 shadow-lg shadow-violet-950/20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-cyan-100/70">Balance</p>
        <p className="text-xl font-extrabold text-white">
          {balance ? `৳ ${parseFloat(balance.balance).toFixed(2)}` : '—'}
        </p>
      </div>

      {/* Nav */}
      <nav className="mt-4 flex-1 space-y-1 px-3">
        {NAV.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-all duration-200',
              pathname.startsWith(href)
                ? 'bg-gradient-to-r from-violet-500/20 to-cyan-400/10 text-white ring-1 ring-violet-300/20 shadow-lg shadow-violet-950/10'
                : 'text-slate-300 hover:bg-white/[0.07] hover:text-white hover:translate-x-0.5',
            )}
          >
            <span className="text-base">{icon}</span>
            {label}
          </Link>
        ))}
      </nav>

      {/* Admin link */}
      {user && ADMIN_ROLES.includes(user.role) && (
        <div className="px-3 pb-2">
          <Link
            href="/admin"
            className={clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              pathname.startsWith('/admin')
                ? 'bg-sky-400/10 text-sky-200 ring-1 ring-sky-300/20'
                : 'text-sky-300 hover:bg-sky-300/10 hover:text-sky-100',
            )}
          >
            <span className="text-base">🛡️</span>
            Admin Panel
          </Link>
        </div>
      )}

      {/* User + Logout */}
      <div className="border-t border-white/10 bg-black/10 p-4">
        <p className="truncate text-sm font-medium text-white">{user?.username}</p>
        <p className="truncate text-xs text-gray-500">{user?.email}</p>
        <button
          onClick={handleLogout}
          className="mt-3 w-full rounded-lg border border-white/10 py-1.5 text-xs text-gray-400 transition hover:border-red-500/50 hover:text-red-400"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
