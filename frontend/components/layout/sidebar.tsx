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
    <aside className="flex h-full w-60 flex-col border-r border-white/10 bg-[#141414]">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <span className="text-xl font-bold text-amber-400">BetPlatform</span>
      </div>

      {/* Balance */}
      <div className="mx-4 mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
        <p className="text-xs text-amber-400/70">Balance</p>
        <p className="text-lg font-bold text-amber-400">
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
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-amber-500/10 text-amber-400'
                : 'text-gray-400 hover:bg-white/5 hover:text-white',
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
                ? 'bg-indigo-500/10 text-indigo-400'
                : 'text-indigo-500 hover:bg-white/5 hover:text-indigo-300',
            )}
          >
            <span className="text-base">🛡️</span>
            Admin Panel
          </Link>
        </div>
      )}

      {/* User + Logout */}
      <div className="border-t border-white/10 p-4">
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
