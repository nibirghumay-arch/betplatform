'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import clsx from 'clsx';

const NAV = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/users', label: 'Users', exact: false },
  { href: '/admin/payments', label: 'Payments', exact: false },
  { href: '/admin/games', label: 'Games', exact: false },
  { href: '/admin/bonuses', label: 'Bonuses', exact: false },
  { href: '/admin/reports', label: 'Reports', exact: false },
  { href: '/admin/audit', label: 'Audit Log', exact: false },
];

interface AdminSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ isOpen = true, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const logout = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={clsx(
          'fixed inset-0 z-30 bg-black/60 transition-opacity md:hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Sidebar — fixed overlay on mobile, in-flow on desktop */}
      <div
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-52 flex-shrink-0 flex-col',
          'border-r border-white/5 bg-[#0d0d14]',
          'transform transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0',
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">
              Admin Console
            </p>
            <p className="mt-0.5 text-base font-bold text-white">Platform</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white md:hidden"
              aria-label="Close menu"
            >
              ✕
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {NAV.map(({ href, label, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={clsx(
                  'flex items-center rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-indigo-600/20 font-medium text-indigo-300'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white',
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-white/5 px-3 py-3">
          <div className="mb-2 px-1">
            <p className="truncate text-xs font-medium text-white">{user?.username}</p>
            <p className="text-[10px] text-indigo-400">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
