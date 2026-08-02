import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  DashboardStats,
  AnalyticsSnapshot,
  WithdrawalItem,
  BonusRule,
  RevenueRow,
  PlayerSegment,
  GameDefinition,
} from '@/types';

const PAGE_SIZE = 20;

// ─── Analytics ────────────────────────────────────────────────────────────────

export function useAdminDashboard() {
  return useQuery<DashboardStats>({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get('/admin/analytics/dashboard').then((r) => r.data),
    refetchInterval: 60_000,
  });
}

export function useAdminSnapshots(days = 30) {
  return useQuery<AnalyticsSnapshot[]>({
    queryKey: ['admin', 'snapshots', days],
    queryFn: () =>
      api.get('/admin/analytics/snapshots', { params: { days } }).then((r) => r.data),
  });
}

export function usePlayerSegments() {
  return useQuery<PlayerSegment[]>({
    queryKey: ['admin', 'segments'],
    queryFn: () => api.get('/admin/analytics/segments').then((r) => r.data),
    staleTime: 300_000,
  });
}

// ─── Games ────────────────────────────────────────────────────────────────────

export function useAdminGameCatalog() {
  return useQuery<GameDefinition[]>({
    queryKey: ['admin', 'games'],
    queryFn: () => api.get('/provider/html5/games').then((r) => r.data),
    staleTime: 30_000,
  });
}

// ─── Withdrawals ──────────────────────────────────────────────────────────────

export function useWithdrawalQueue(status = 'PENDING_REVIEW', page = 0) {
  return useQuery<WithdrawalItem[]>({
    queryKey: ['admin', 'withdrawals', status, page],
    queryFn: () =>
      api
        .get('/admin/withdrawal/queue', {
          params: { status, skip: page * PAGE_SIZE, take: PAGE_SIZE },
        })
        .then((r) => r.data),
  });
}

export function useApproveWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminId }: { id: string; adminId: string }) =>
      api.post(`/admin/withdrawal/${id}/approve`, { adminId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'withdrawals'] }),
  });
}

export function useRejectWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminId, reason }: { id: string; adminId: string; reason: string }) =>
      api.post(`/admin/withdrawal/${id}/reject`, { adminId, reason }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'withdrawals'] }),
  });
}

// ─── Bonus rules ──────────────────────────────────────────────────────────────

export function useAdminBonusRules(page = 0) {
  return useQuery<BonusRule[]>({
    queryKey: ['admin', 'bonus-rules', page],
    queryFn: () =>
      api
        .get('/admin/bonus/rules', { params: { skip: page * PAGE_SIZE, take: PAGE_SIZE } })
        .then((r) => r.data),
  });
}

export function useCreateBonusRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      bonusType: string;
      triggerEvent: string;
      config: Record<string, unknown>;
      priority?: number;
      maxClaimsPerUser?: number;
      startsAt?: string;
      endsAt?: string;
    }) => api.post('/admin/bonus/rules', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'bonus-rules'] }),
  });
}

export function useToggleBonusRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api
        .post(`/admin/bonus/rules/${id}/${active ? 'activate' : 'deactivate'}`)
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'bonus-rules'] }),
  });
}

// ─── Revenue report ───────────────────────────────────────────────────────────

export function useRevenueReport(from: string, to: string, groupBy: 'day' | 'month' = 'day') {
  return useQuery<RevenueRow[]>({
    queryKey: ['admin', 'revenue', from, to, groupBy],
    queryFn: () =>
      api
        .get('/admin/reports/revenue/inline', { params: { from, to, groupBy } })
        .then((r) => r.data),
    enabled: !!(from && to),
  });
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export function useAuditLogs(action?: string, page = 0) {
  return useQuery({
    queryKey: ['admin', 'audit', action, page],
    queryFn: () =>
      api
        .get('/admin/audit', {
          params: { action: action || undefined, skip: page * PAGE_SIZE, take: PAGE_SIZE },
        })
        .then((r) => r.data),
    retry: false,
  });
}
