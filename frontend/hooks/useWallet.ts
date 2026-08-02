import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Wallet, Transaction, Deposit } from '@/types';

export function useWallet() {
  const user = useAuthStore((s) => s.user);
  return useQuery<Wallet>({
    queryKey: ['wallet', user?.id],
    queryFn: () => api.get(`/wallets/user/${user!.id}`).then((r) => r.data),
    enabled: !!user,
  });
}

export function useBalance() {
  const user = useAuthStore((s) => s.user);
  return useQuery<{ balance: string; currency: string }>({
    queryKey: ['balance', user?.id],
    queryFn: () => api.get(`/wallets/user/${user!.id}/balance`).then((r) => r.data),
    enabled: !!user,
    refetchInterval: 15_000,
  });
}

export function useTransactionHistory(page: number, type?: string) {
  const user = useAuthStore((s) => s.user);
  const take = 20;
  const skip = page * take;
  return useQuery<Transaction[]>({
    queryKey: ['transactions', user?.id, page, type],
    queryFn: () =>
      api
        .get('/transactions', { params: { userId: user!.id, skip, take, type: type || undefined } })
        .then((r) => r.data),
    enabled: !!user,
  });
}

export function useDepositHistory() {
  const user = useAuthStore((s) => s.user);
  return useQuery<Deposit[]>({
    queryKey: ['deposits', user?.id],
    queryFn: () =>
      api.get('/payment/deposit', { params: { userId: user!.id } }).then((r) => r.data),
    enabled: !!user,
  });
}
