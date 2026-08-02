'use client';

import Link from 'next/link';
import { usePlayerSegments } from '@/hooks/useAdmin';
import { Card, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { PlayerSegment } from '@/types';

const SEGMENT_META: Record<
  PlayerSegment['segment'],
  { label: string; badge: string }
> = {
  high_roller: { label: 'High Rollers', badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400' },
  dormant: { label: 'Dormant (30d)', badge: 'bg-white/5 border-white/10 text-gray-400' },
  new: { label: 'New (7d)', badge: 'bg-green-500/10 border-green-500/20 text-green-400' },
};

export default function UsersPage() {
  const { data: segments = [], isLoading } = usePlayerSegments();

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="hidden text-xs text-gray-500 sm:block">
          Segmented view via{' '}
          <code className="text-indigo-400">GET /admin/analytics/segments</code>
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-10 w-10" />
        </div>
      ) : segments.length === 0 ? (
        <div className="py-20 text-center text-sm text-gray-500">
          No segments yet. Take a snapshot from the dashboard first.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {segments.map((seg) => {
            const meta = SEGMENT_META[seg.segment];
            return (
              <Card key={seg.segment}>
                <div className="mb-4 flex items-center justify-between">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${meta.badge}`}
                  >
                    {meta.label}
                  </span>
                  <span className="text-2xl font-bold text-white">{seg.count}</span>
                </div>

                <div className="max-h-52 space-y-0.5 overflow-y-auto">
                  {seg.userIds.map((id) => (
                    <Link
                      key={id}
                      href={`/admin/users/${id}`}
                      className="block rounded px-2 py-1.5 font-mono text-xs text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {id}
                    </Link>
                  ))}
                  {seg.userIds.length === 0 && (
                    <p className="py-3 text-center text-xs text-gray-600">No users in segment</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-gray-600">
        A full searchable user list requires a dedicated{' '}
        <code className="text-indigo-400">GET /admin/users</code> endpoint in the NestJS backend.
      </p>
    </div>
  );
}
