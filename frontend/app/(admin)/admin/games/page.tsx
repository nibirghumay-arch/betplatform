'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminGameCatalog } from '@/hooks/useAdmin';
import { api, apiError } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

export default function GamesPage() {
  const qc = useQueryClient();
  const { data: games = [], isLoading } = useAdminGameCatalog();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/provider/html5/games/${id}`, { isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'games'] }),
    onError: (err, vars) => {
      setErrors((prev) => ({ ...prev, [vars.id]: apiError(err) }));
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Games</h1>
        <p className="hidden text-xs text-gray-500 sm:block">
          Toggle requires{' '}
          <code className="text-indigo-400">PATCH /provider/html5/games/:id</code>
        </p>
      </div>

      <Card>
        <CardTitle>Game Catalog ({games.length})</CardTitle>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : games.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No games found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Slug</th>
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2 pr-4 text-right">RTP</th>
                  <th className="pb-2 pr-4">Featured</th>
                  <th className="pb-2">Toggle</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr key={game.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-2.5 pr-4 font-medium text-white">{game.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-gray-400">{game.slug}</td>
                    <td className="py-2.5 pr-4 text-xs text-gray-400">
                      {game.category?.name ?? '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-xs text-gray-300">
                      {game.rtp != null ? `${Number(game.rtp).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      {game.featured ? (
                        <span className="text-xs text-amber-400">✓</span>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div>
                        <button
                          onClick={() => toggle.mutate({ id: game.id, isActive: false })}
                          disabled={toggle.isPending}
                          className="rounded px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                        {errors[game.id] && (
                          <p className="mt-0.5 text-[10px] text-red-400">{errors[game.id]}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
