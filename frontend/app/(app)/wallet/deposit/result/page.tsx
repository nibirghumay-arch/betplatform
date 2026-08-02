'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Status = 'success' | 'failed' | 'cancelled';

function statusContent(status: Status | null, reason: string | null) {
  switch (status) {
    case 'success':
      return {
        icon: '✅',
        title: 'Deposit Successful',
        message: 'Your payment was confirmed and your wallet has been credited.',
        tone: 'text-green-400',
      };
    case 'cancelled':
      return {
        icon: '⚠️',
        title: 'Deposit Cancelled',
        message: 'You cancelled the payment before it completed. No funds were charged.',
        tone: 'text-amber-400',
      };
    case 'failed':
      return {
        icon: '❌',
        title: 'Deposit Failed',
        message: reason || 'SSLCommerz was unable to complete this payment. No funds were charged.',
        tone: 'text-red-400',
      };
    default:
      return {
        icon: '❓',
        title: 'Unknown Status',
        message: 'We could not determine the result of this payment. Check your transaction history.',
        tone: 'text-gray-400',
      };
  }
}

function DepositResultContent() {
  const params = useSearchParams();
  const status = params.get('status') as Status | null;
  const depositId = params.get('depositId');
  const reason = params.get('reason');
  const queryClient = useQueryClient();
  const { icon, title, message, tone } = statusContent(status, reason);

  // Refresh balance/transaction data so the wallet page shows the credited
  // amount immediately when the user navigates back, without needing a
  // manual refresh.
  useEffect(() => {
    if (status === 'success') {
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
    }
  }, [status, queryClient]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm text-center">
        <div className="mb-4 text-4xl">{icon}</div>
        <h2 className="mb-2 text-xl font-semibold text-white">{title}</h2>
        <p className={`mb-1 text-sm ${tone}`}>{message}</p>
        {depositId && (
          <p className="mb-6 font-mono text-xs text-gray-600">Reference: {depositId}</p>
        )}
        {!depositId && <div className="mb-6" />}
        <Link href="/wallet">
          <Button className="w-full">Back to Wallet</Button>
        </Link>
      </Card>
    </div>
  );
}

export default function DepositResultPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        </div>
      }
    >
      <DepositResultContent />
    </Suspense>
  );
}
