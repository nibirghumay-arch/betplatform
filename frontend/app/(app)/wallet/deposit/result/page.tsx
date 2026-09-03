'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Status = 'success' | 'failed' | 'cancelled' | 'pending';

// The BD gateway credits asynchronously: the customer is back here as soon as
// they submit their TrxID, while the forwarded SMS may still be in flight. Poll
// the reconcile endpoint until the deposit resolves instead of leaving them on
// a dead page.
const POLL_FIRST_DELAY_MS = 1_500;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 150_000;

function statusContent(status: Status | null, reason: string | null) {
  switch (status) {
    case 'success':
      return {
        icon: '✅',
        title: 'Deposit Successful',
        message: 'Your payment was confirmed and your wallet has been credited.',
        tone: 'text-green-400',
      };
    case 'pending':
      return {
        icon: '⏳',
        title: 'Verifying Your Payment',
        message:
          'We are matching your TrxID against the confirmation SMS. This usually takes a few seconds — keep this page open.',
        tone: 'text-amber-400',
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
        message: reason || 'This payment could not be completed. No funds were credited.',
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
  const queryClient = useQueryClient();

  const urlStatus = params.get('status') as Status | null;
  const depositId = params.get('depositId');
  const reason = params.get('reason');

  // Resolved by polling; overrides the (optimistic) status from the URL.
  const [resolved, setResolved] = useState<Status | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const status = resolved ?? urlStatus;

  const refreshWallet = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['balance'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [queryClient]);

  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (urlStatus !== 'pending' || !depositId || resolved) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await api.post(`/payment/deposit/bdgateway/${depositId}/reconcile`);
        if (cancelled) return;
        const depositStatus = res.data?.status as string | undefined;
        if (depositStatus === 'COMPLETED') {
          setResolved('success');
          refreshWallet();
          return;
        }
        if (depositStatus === 'FAILED' || depositStatus === 'CANCELLED') {
          setResolved('failed');
          return;
        }
      } catch {
        // A transient error shouldn't end the poll — the webhook may still land.
      }
      if (cancelled) return;
      if (Date.now() - startedAt.current < POLL_TIMEOUT_MS) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      } else {
        setTimedOut(true);
      }
    };

    timer = setTimeout(tick, POLL_FIRST_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [urlStatus, depositId, resolved, refreshWallet]);

  useEffect(() => {
    if (urlStatus === 'success') refreshWallet();
  }, [urlStatus, refreshWallet]);

  const { icon, title, message, tone } = statusContent(status, reason);
  const stillWaiting = status === 'pending' && !timedOut;

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Card className="text-center">
        <div className="mb-4 text-5xl">{icon}</div>
        <h1 className={`mb-2 text-xl font-bold ${tone}`}>{title}</h1>
        <p className="mb-6 text-sm text-gray-400">
          {timedOut
            ? 'This is taking longer than usual. Your deposit is still being verified — it will be credited automatically once the SMS is matched. You can safely close this page.'
            : message}
        </p>

        {stillWaiting && (
          <div className="mb-6 flex items-center justify-center gap-2 text-xs text-gray-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            Checking for your confirmation…
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Link href="/wallet">
            <Button className="w-full">Back to Wallet</Button>
          </Link>
          {status !== 'success' && !stillWaiting && (
            <Link href="/wallet">
              <Button variant="ghost" className="w-full">Try Again</Button>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function DepositResultPage() {
  // useSearchParams() needs a Suspense boundary for static prerendering.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-6 py-16">
          <Card className="text-center text-sm text-gray-400">Loading…</Card>
        </div>
      }
    >
      <DepositResultContent />
    </Suspense>
  );
}

