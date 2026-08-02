import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { GameDefinition, GameCategory } from '@/types';

const PROVIDER = 'html5';

export function useGameCatalog(categorySlug?: string) {
  return useQuery<GameDefinition[]>({
    queryKey: ['games', categorySlug],
    queryFn: () =>
      api
        .get(`/provider/${PROVIDER}/games`, {
          params: categorySlug ? { categorySlug, isActive: true } : { isActive: true },
        })
        .then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useGameCategories() {
  return useQuery<GameCategory[]>({
    queryKey: ['game-categories'],
    queryFn: () => api.get(`/provider/${PROVIDER}/games/categories`).then((r) => r.data),
    staleTime: 300_000,
  });
}

export function useGameBySlug(slug: string) {
  return useQuery<GameDefinition>({
    queryKey: ['game', slug],
    queryFn: () =>
      api
        .get(`/provider/${PROVIDER}/games`, { params: { isActive: true } })
        .then((r) => {
          const games: GameDefinition[] = r.data;
          const found = games.find((g) => g.slug === slug);
          if (!found) throw new Error('Game not found');
          return found;
        }),
    staleTime: 60_000,
  });
}
