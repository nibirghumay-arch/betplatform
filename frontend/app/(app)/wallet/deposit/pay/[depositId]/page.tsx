'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, apiError } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

type DepositRecord = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  pspProvider: string;
  paymentChannel?: string | null;
  metadata?: {
    bdGateway?: {
      provider: string;
      receivingNumber: string;
      amountBdt: number;
      currency: string;
      expiresAt: string;
    };
  } | null;
  createdAt: string;
};

function maskNumber(value: string) {
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export default function BetPlatformGatewayCheckoutPage() {
  const params = useParams<{ depositId: string }>();
  const router = useRouter();
  const depositId = params.depositId;

  const [deposit, setDeposit] = useState<DepositRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [trxId, setTrxId] = useState('');
  const [customerMsisdn, setCustomerMsisdn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const loadDeposit = useCallback(async () => {
    const response = await api.get(`/payment/deposit/${encodeURIComponent(depositId)}`);
    setDeposit(response.data as DepositRecord);
    return response.data as DepositRecord;
  }, [depositId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadDeposit()
      .catch((err) => {
        if (active) setError(apiError(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadDeposit]);

  const status = deposit?.status;
  const terminal = status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';

  useEffect(() => {
    if (!deposit || terminal || deposit.pspProvider !== 'bdgateway') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        await api.post(`/payment/deposit/bdgateway/${encodeURIComponent(deposit.id)}/reconcile`);
        const updated = await loadDeposit();
        if (!cancelled && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(updated.status)) {
          setNotice(updated.status === 'COMPLETED'
            ? 'Payment verified and your wallet has been credited.'
            : 'This deposit is no longer pending. Check the status below.');
          if (updated.status === 'COMPLETED') {
            router.refresh();
          }
          return;
        }
      } catch {
        // Temporary gateway/network errors do not discard the pending order.
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    };

    timer = setTimeout(poll, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deposit, terminal, loadDeposit, router]);

  const gatewayInfo = deposit?.metadata?.bdGateway;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!/^[A-Za-z0-9]{6,20}$/.test(trxId.trim())) {
      setError('Enter the 6–20 character TrxID from your payment confirmation.');
      return;
    }
    if (customerMsisdn && !/^01[3-9]\d{8}$/.test(customerMsisdn)) {
      setError('Enter a valid 11-digit Bangladeshi mobile number.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post(
        `/payment/deposit/bdgateway/${encodeURIComponent(depositId)}/submit-trx`,
        { trxId: trxId.trim(), ...(customerMsisdn ? { customerMsisdn } : {}) },
      );
      setNotice(response.data.message ?? 'TrxID submitted. Payment verification is in progress.');
      await loadDeposit();
      setTrxId('');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const copyNumber = async () => {
    if (!gatewayInfo?.receivingNumber) return;
    try {
      await navigator.clipboard.writeText(gatewayInfo.receivingNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy the number. Please copy it manually.');
    }
  };

  if (loading) {
    return <div className="mx-auto flex max-w-md justify-center px-6 py-16"><Spinner /></div>;
  }

  if (!deposit) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <Card>
          <h1 className="mb-2 text-lg font-semibold text-white">Payment request unavailable</h1>
          <p className="mb-4 text-sm text-gray-400">{error || 'This payment request could not be found.'}</p>
          <Link href="/wallet"><Button className="w-full">Back to Wallet</Button></Link>
        </Card>
      </div>
    );
  }

  const complete = deposit.status === 'COMPLETED';
  const expired = deposit.status === 'FAILED' || deposit.status === 'CANCELLED';

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">BetPlatform secure payment</p>
        <h1 className="mt-1 text-2xl font-bold text-white">Complete your deposit</h1>
        <p className="mt-1 text-sm text-gray-400">You can complete the entire payment here. You do not need to sign in to any gateway website.</p>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Deposit summary</CardTitle>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${complete ? 'bg-green-500/15 text-green-400' : expired ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-300'}`}>
            {deposit.status.replaceAll('_', ' ')}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500">Amount to send</p>
            <p className="mt-1 text-2xl font-bold text-amber-400">৳{Number(deposit.amount).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Payment method</p>
            <p className="mt-1 font-semibold text-white">{deposit.paymentChannel || gatewayInfo?.provider || 'BD Gateway'}</p>
          </div>
        </div>
        {gatewayInfo && (
          <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Send Money to this number</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="font-mono text-xl font-bold tracking-wide text-white">{gatewayInfo.receivingNumber}</p>
              <Button size="sm" variant="secondary" onClick={copyNumber}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <p className="mt-2 text-xs text-gray-400">Send the exact amount shown above using {deposit.paymentChannel || gatewayInfo.provider}. Do not send to a different number.</p>
            <p className="mt-2 text-xs text-gray-500">Payment instruction expires: {new Date(gatewayInfo.expiresAt).toLocaleString()}</p>
          </div>
        )}
      </Card>

      {!complete && !expired && (
        <Card>
          <CardTitle>Submit your transaction ID</CardTitle>
          <p className="mb-4 mt-2 text-sm text-gray-400">After sending the money, copy the TrxID from your confirmation message and enter it below.</p>
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Transaction ID (TrxID)"
              placeholder="Enter the TrxID"
              value={trxId}
              onChange={(event) => setTrxId(event.target.value)}
              autoComplete="off"
            />
            <Input
              label="Your mobile number (optional)"
              placeholder="01XXXXXXXXX"
              value={customerMsisdn}
              onChange={(event) => setCustomerMsisdn(event.target.value)}
              inputType="tel"
            />
            {error && <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</p>}
            {notice && <p className="rounded-lg bg-green-900/20 px-3 py-2 text-sm text-green-300">{notice}</p>}
            <Button type="submit" loading={submitting} className="w-full">Submit TrxID for verification</Button>
          </form>
          <p className="mt-4 text-xs text-gray-500">Your payment is not credited just because a TrxID is entered. BetPlatform verifies the order with the gateway server before updating your wallet.</p>
        </Card>
      )}

      {(complete || expired) && (
        <Card>
          <h2 className={`text-lg font-semibold ${complete ? 'text-green-400' : 'text-red-400'}`}>
            {complete ? 'Deposit confirmed' : 'Deposit not completed'}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {complete
              ? 'The gateway verified the payment and BetPlatform has credited your wallet.'
              : deposit.status === 'CANCELLED'
                ? 'This deposit was cancelled.'
                : 'This deposit could not be completed. Please check your transaction history or contact site support.'}
          </p>
        </Card>
      )}

      {notice && !complete && !expired && (
        <p className="rounded-lg bg-green-900/20 px-3 py-2 text-sm text-green-300">{notice}</p>
      )}

      <div className="flex gap-3">
        <Link href="/wallet" className="flex-1"><Button variant="secondary" className="w-full">Back to Wallet</Button></Link>
        <Link href="/wallet" className="flex-1"><Button className="w-full">View Wallet</Button></Link>
      </div>
      <p className="text-center text-xs text-gray-600">Payment processing is handled by BetPlatform. Never share your PIN or OTP.</p>
    </div>
  );
}
