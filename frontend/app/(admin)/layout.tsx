'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

const Checking = () => (
  <div className="flex h-screen items-center justify-center bg-[#0a0a0f]">
    <p className="text-sm text-gray-600">Checking access…</p>
  </div>
);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && (!isAuthenticated() || !user || !ADMIN_ROLES.includes(user.role))) {
      router.replace('/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  // Before mount: server and initial client both render Checking → no hydration mismatch
  if (!mounted) return <Checking />;
  if (!isAuthenticated() || !user || !ADMIN_ROLES.includes(user.role)) return <Checking />;

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar — hamburger + title */}
        <div className="flex items-center border-b border-white/5 bg-[#0d0d14] px-4 py-3 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white"
            aria-label="Open menu"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="ml-3 text-sm font-semibold text-white">Admin Console</span>
        </div>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
