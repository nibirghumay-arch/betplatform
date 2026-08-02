'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useGameCatalog, useGameCategories } from '@/hooks/useGames';
import { useAuthStore } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { GameDefinition } from '@/types';
import { Spinner } from '@/components/ui/spinner';
import clsx from 'clsx';

const PROVIDER = 'html5';
const ALL = 'all';

function GameCard({ game, onLaunch, launching }: { game: GameDefinition; onLaunch: () => void; launching: boolean }) {
  return (
    <button
      onClick={onLaunch}
      disabled={launching}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-all hover:border-amber-500/40 hover:bg-white/10 disabled:opacity-60"
    >
      {/* Thumbnail */}
      <div className="aspect-[4/3] w-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center relative overflow-hidden">
        {game.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.thumbnailUrl} alt={game.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-4xl opacity-30">🎮</span>
        )}
        {game.featured && (
          <span className="absolute top-2 left-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">
            FEATURED
          </span>
        )}
        {launching && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Spinner />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <span className="rounded-full bg-amber-500 px-4 py-1.5 text-sm font-bold text-black">Play</span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 text-left">
        <p className="truncate text-sm font-medium text-white">{game.name}</p>
        {game.rtp != null && (
          <p className="text-xs text-gray-500 mt-0.5">RTP {parseFloat(String(game.rtp)).toFixed(1)}%</p>
        )}
      </div>
    </button>
  );
}

export default function LobbyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(ALL);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const { data: categories = [] } = useGameCategories();
  const { data: allGames = [], isLoading } = useGameCatalog(
    activeCategory === ALL ? undefined : activeCategory,
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return allGames;
    const q = search.toLowerCase();
    return allGames.filter((g) => g.name.toLowerCase().includes(q));
  }, [allGames, search]);

  const featured = useMemo(() => allGames.filter((g) => g.featured), [allGames]);

  const launchMutation = useMutation({
    mutationFn: async (game: GameDefinition) => {
      setLaunchingId(game.id);
      // create session
      const sessionRes = await api.post(`/provider/${PROVIDER}/sessions`, {
        userId: user!.id,
        gameId: game.id,
        currency: 'BDT',
      });
      const sessionId = sessionRes.data.sessionId;
      // get launch URL
      await api.post(`/provider/${PROVIDER}/sessions/${sessionId}/launch`);
      return { slug: game.slug, sessionId };
    },
    onSuccess: ({ slug, sessionId }) => {
      router.push(`/game/${slug}?session=${sessionId}`);
    },
    onError: (err) => {
      alert(apiError(err));
      setLaunchingId(null);
    },
  });

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Game Lobby</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {allGames.length} games available
          </p>
        </div>
        {/* Search */}
        <input
          type="search"
          placeholder="Search games..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        />
      </div>

      {/* Category tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveCategory(ALL)}
          className={clsx(
            'flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            activeCategory === ALL
              ? 'bg-amber-500 text-black'
              : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white',
          )}
        >
          All Games
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.slug)}
            className={clsx(
              'flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              activeCategory === cat.slug
                ? 'bg-amber-500 text-black'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white',
            )}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Featured section — only shown on "All" tab with no search */}
      {activeCategory === ALL && !search && featured.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-400">
            Featured
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {featured.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onLaunch={() => launchMutation.mutate(game)}
                launching={launchingId === game.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* All games grid */}
      <section>
        {activeCategory !== ALL && (
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
            {categories.find((c) => c.slug === activeCategory)?.name ?? activeCategory}
          </h2>
        )}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner className="h-10 w-10" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-gray-500">
            {search ? `No games matching "${search}"` : 'No games in this category yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onLaunch={() => launchMutation.mutate(game)}
                launching={launchingId === game.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
