import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Bonus, Notification } from '@/types';

export interface VipProgress {
  totalWager: string;
  periodWager: string;
  currentTier: number;
  nextTierAt?: string;
}

export function useVipProgress() {
  const user = useAuthStore((s) => s.user);
  return useQuery<VipProgress>({
    queryKey: ['vip', user?.id],
    queryFn: () =>
      api.get(`/vip/${user!.id}/progress`).then((r) => r.data).catch(() => ({
        totalWager: '0.00',
        periodWager: '0.00',
        currentTier: 0,
      })),
    enabled: !!user,
  });
}

export function useActiveBonuses() {
  const user = useAuthStore((s) => s.user);
  return useQuery<Bonus[]>({
    queryKey: ['bonuses-active', user?.id],
    queryFn: () => api.get(`/bonus/${user!.id}/active`).then((r) => r.data),
    enabled: !!user,
  });
}

export function useBonusHistory() {
  const user = useAuthStore((s) => s.user);
  return useQuery<Bonus[]>({
    queryKey: ['bonuses', user?.id],
    queryFn: () => api.get(`/bonus/${user!.id}`).then((r) => r.data),
    enabled: !!user,
  });
}

export function useNotifications(unreadOnly = false) {
  return useQuery<Notification[]>({
    queryKey: ['notifications', unreadOnly],
    queryFn: () =>
      api.get('/notifications', { params: unreadOnly ? { unreadOnly: true } : {} }).then((r) => r.data),
    refetchInterval: 30_000,
  });
}
