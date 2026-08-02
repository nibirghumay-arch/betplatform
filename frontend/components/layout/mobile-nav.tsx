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
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/10 bg-[#141414] md:hidden">
      {NAV.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          className={clsx(
            'flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors',
            pathname.startsWith(href) ? 'text-amber-400' : 'text-gray-500',
          )}
        >
          <span className="text-lg">{icon}</span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
