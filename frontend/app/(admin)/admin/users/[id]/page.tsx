'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { Wallet, Transaction } from '@/types';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

function useUserWallet(userId: string) {
  return useQuery<Wallet>({
    queryKey: ['admin', 'user-wallet', userId],
    queryFn: () => api.get(`/wallets/user/${userId}`).then((r) => r.data),
    retry: false,
  });
}

function useUserTransactions(userId: string) {
  return useQuery<Transaction[]>({
    queryKey: ['admin', 'user-txs', userId],
    queryFn: () =>
      api.get('/transactions', { params: { userId, skip: 0, take: 20 } }).then((r) => r.data),
    retry: false,
  });
}

const CREDIT_TYPES = ['DEPOSIT', 'WIN', 'BONUS_CREDIT'];

export default function UserDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();
  const [actionMsg, setActionMsg] = useState('');
  const [actionError, setActionError] = useState('');

  const { data: wallet, isLoading: walletLoading } = useUserWallet(id);
  const { data: txs = [], isLoading: txLoading } = useUserTransactions(id);

  const walletAction = useMutation({
    mutationFn: ({ action, walletId }: { action: string; walletId: string }) =>
      api.patch(`/wallets/${walletId}/${action}`),
    onSuccess: (_, vars) => {
      setActionMsg(`Wallet ${vars.action}d successfully.`);
      setActionError('');
      qc.invalidateQueries({ queryKey: ['admin', 'user-wallet', id] });
    },
    onError: (err) => {
      setActionError(apiError(err));
      setActionMsg('');
    },
  });

  const act = (action: string) => {
    if (!wallet) return;
    setActionMsg('');
    setActionError('');
    walletAction.mutate({ action, walletId: wallet.id });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-6 flex min-w-0 items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex-shrink-0 text-xs text-gray-500 transition-colors hover:text-white"
        >
          ← Back
        </button>
        <h1 className="min-w-0 truncate font-mono text-lg font-bold text-white sm:text-xl">{id}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Wallet card */}
        <Card>
          <CardTitle>Wallet</CardTitle>

          {walletLoading ? (
            <Spinner />
          ) : !wallet ? (
            <p className="text-sm text-gray-500">No wallet found for this user.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Wallet ID</span>
                <span className="font-mono text-xs text-white">{wallet.id}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Balance</span>
                <span className="text-xl font-bold text-amber-400">
                  ৳ {parseFloat(wallet.balance).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          {wallet && (
            <div className="mt-5">
              {actionMsg && <p className="mb-2 text-xs text-green-400">{actionMsg}</p>}
              {actionError && <p className="mb-2 text-xs text-red-400">{actionError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={walletAction.isPending}
                  onClick={() => act('freeze')}
                >
                  Freeze
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={walletAction.isPending}
                  onClick={() => act('unfreeze')}
                >
                  Unfreeze
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={walletAction.isPending}
                  onClick={() => {
                    if (confirm('Permanently deactivate this wallet? This cannot be undone.')) {
                      act('deactivate');
                    }
                  }}
                >
                  Deactivate
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Recent transactions */}
        <Card>
          <CardTitle>Recent Transactions</CardTitle>

          {txLoading ? (
            <Spinner />
          ) : txs.length === 0 ? (
            <p className="text-sm text-gray-500">No transactions found.</p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {txs.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium text-white">{tx.type}</span>
                    <span className="ml-2 text-gray-500">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        CREDIT_TYPES.includes(tx.type)
                          ? 'font-mono text-green-400'
                          : 'font-mono text-red-400'
                      }
                    >
                      {CREDIT_TYPES.includes(tx.type) ? '+' : '-'}
                      {parseFloat(tx.amount).toFixed(2)}
                    </span>
                    <Badge label={tx.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
