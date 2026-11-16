'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const NAV = [
  { href: '/lobby', label: 'Lobby', icon: '🎮' },
  { href: '/wallet', label: 'Wallet', icon: '💳' },
  { href: '/profile', label: 'Profile', icon: '👤' },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/10 bg-[#10182c]/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_35px_rgba(3,7,18,0.38)] backdrop-blur-2xl md:hidden">
      {NAV.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          className={clsx(
            'relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-all duration-200',
            pathname.startsWith(href) ? 'text-cyan-200' : 'text-slate-400 hover:text-white',
          )}
        >
          <span className="flex h-8 w-9 items-center justify-center rounded-xl bg-white/[0.045] text-lg">{icon}</span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
