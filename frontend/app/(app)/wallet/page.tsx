'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useBalance, useTransactionHistory } from '@/hooks/useWallet';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { useAuthStore } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { PaymentMethodType, PAYMENT_METHOD_LABELS } from '@/types';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { PaymentMethodManager } from '@/components/payment/PaymentMethodManager';

// ─── Deposit form ──────────────────────────────────────────────────────────

const MOBILE_WALLETS: PaymentMethodType[] = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY', 'MCASH', 'TAP'];

const depositSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount').refine((v) => parseFloat(v) >= 10, 'Minimum ৳10'),
    pspProvider: z.string().min(1, 'Select a provider'),
    mobileGateway: z.string().optional(),
    phone: z.string().optional(),
  })
  .refine(
    (data) => data.pspProvider !== 'sslcommerz' || /^01[3-9]\d{8}$/.test(data.phone ?? ''),
    { message: 'Enter an 11-digit BD mobile number, e.g. 01712345678', path: ['phone'] },
  );
type DepositForm = z.infer<typeof depositSchema>;

function DepositCard() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [redirecting, setRedirecting] = useState(false);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<DepositForm>({
    resolver: zodResolver(depositSchema),
    defaultValues: { pspProvider: 'sslcommerz', mobileGateway: 'BKASH' },
  });
  const pspProvider = watch('pspProvider');

  const onSubmit = async (data: DepositForm) => {
    setServerError('');
    try {
      const res = await api.post('/payment/deposit', {
        userId: user!.id,
        amount: parseFloat(data.amount),
        currency: 'BDT',
        pspProvider: data.pspProvider,
        ...(data.pspProvider === 'sslcommerz' && {
          mobileGateway: data.mobileGateway,
          customer: {
            name: user!.username,
            email: user!.email,
            phone: data.phone,
          },
        }),
      });
      if (res.data.checkoutUrl) {
        // SSLCommerz (and other real PSPs) return their own hosted checkout
        // page — send the browser there directly, since SSLCommerz redirects
        // back to our own success/fail/cancel URLs once payment resolves.
        setRedirecting(true);
        window.location.href = res.data.checkoutUrl;
      } else {
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        reset();
      }
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <Card>
      <CardTitle>Deposit Funds</CardTitle>
      {redirecting ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-gray-400">Redirecting you to the secure checkout page…</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Payment Method</label>
            <select
              {...register('pspProvider')}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="sslcommerz">Mobile Banking / Card (SSLCommerz)</option>
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
            </select>
          </div>

          {pspProvider === 'sslcommerz' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-300">Mobile Wallet</label>
                <select
                  {...register('mobileGateway')}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                >
                  {MOBILE_WALLETS.map((w) => (
                    <option key={w} value={w}>{PAYMENT_METHOD_LABELS[w]}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  You&apos;ll complete payment on SSLCommerz&apos;s secure page using this method.
                </p>
              </div>
              <Input
                label="Mobile Number"
                placeholder="01712345678"
                error={errors.phone?.message}
                {...register('phone')}
              />
            </>
          )}

          <Input
            label="Amount (BDT)"
            placeholder="100.00"
            error={errors.amount?.message}
            {...register('amount')}
          />

          {serverError && (
            <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
          )}
          <Button type="submit" loading={isSubmitting} className="w-full">
            Deposit
          </Button>
        </form>
      )}
    </Card>
  );
}

// ─── Withdrawal form ──────────────────────────────────────────────────────

const withdrawSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount').refine((v) => parseFloat(v) >= 20, 'Minimum ৳20'),
  paymentMethodId: z.string().min(1, 'Select a payment method'),
});
type WithdrawForm = z.infer<typeof withdrawSchema>;

function WithdrawCard() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const { data: methods = [] } = usePaymentMethods();
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  const defaultMethod = methods.find((m) => m.isDefault);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<WithdrawForm>({
    resolver: zodResolver(withdrawSchema),
    values: { amount: '', paymentMethodId: defaultMethod?.id ?? '' },
  });

  const onSubmit = async (data: WithdrawForm) => {
    setServerError('');
    setSuccess(false);
    try {
      await api.post('/payment/withdrawal', {
        userId: user!.id,
        amount: parseFloat(data.amount),
        currency: 'BDT',
        pspProvider: 'sslcommerz',
        paymentMethodId: data.paymentMethodId,
      });
      setSuccess(true);
      reset();
      queryClient.invalidateQueries({ queryKey: ['balance'] });
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <Card>
      <CardTitle>Withdraw Funds</CardTitle>
      {success && (
        <div className="mb-4 rounded-lg bg-green-900/30 px-3 py-2 text-sm text-green-400">
          Withdrawal request submitted. Pending review.
        </div>
      )}

      {methods.length === 0 ? (
        <p className="rounded-lg bg-amber-900/20 px-3 py-2 text-sm text-amber-300">
          Add a bKash, Nagad, Rocket, or Upay account below before requesting a withdrawal.
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Pay out to</label>
            <select
              {...register('paymentMethodId')}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || PAYMENT_METHOD_LABELS[m.type]} · ••••{m.accountNumber.slice(-4)}
                  {m.isDefault ? ' (active)' : ''}
                </option>
              ))}
            </select>
            {errors.paymentMethodId && (
              <p className="text-xs text-red-400">{errors.paymentMethodId.message}</p>
            )}
          </div>

          <Input
            label="Amount (BDT)"
            placeholder="500.00"
            error={errors.amount?.message}
            {...register('amount')}
          />
          <p className="text-xs text-gray-500">Minimum withdrawal: ৳20. Processed within 1-3 business days.</p>
          {serverError && (
            <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
          )}
          <Button type="submit" variant="secondary" loading={isSubmitting} className="w-full">
            Request Withdrawal
          </Button>
        </form>
      )}
    </Card>
  );
}

// ─── Transaction history ──────────────────────────────────────────────────

const TX_TYPES = ['', 'DEPOSIT', 'WITHDRAWAL', 'BET', 'WIN', 'BONUS_CREDIT', 'BONUS_DEBIT'];

function TransactionHistory() {
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const { data: txs = [], isLoading } = useTransactionHistory(page, typeFilter || undefined);

  return (
    <Card className="col-span-full">
      <div className="mb-4 flex items-center justify-between gap-4">
        <CardTitle>Transaction History</CardTitle>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white focus:outline-none"
        >
          {TX_TYPES.map((t) => (
            <option key={t} value={t}>{t || 'All Types'}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : txs.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">No transactions found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4 text-right">Amount</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((tx) => (
                <tr key={tx.id} className="border-b border-white/5 hover:bg-white/3">
                  <td className="py-2.5 pr-4 text-gray-400 whitespace-nowrap">
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 pr-4 font-medium text-white">{tx.type}</td>
                  <td className="py-2.5 pr-4 text-right font-mono">
                    <span className={
                      ['DEPOSIT', 'WIN', 'BONUS_CREDIT'].includes(tx.type)
                        ? 'text-green-400'
                        : 'text-red-400'
                    }>
                      {['DEPOSIT', 'WIN', 'BONUS_CREDIT'].includes(tx.type) ? '+' : '-'}
                      {parseFloat(tx.amount).toFixed(2)}
                    </span>
                  </td>
                  <td className="py-2.5"><Badge label={tx.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
        <span>Page {page + 1}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="ghost" disabled={txs.length < 20} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const { data: balance, isLoading } = useBalance();

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Wallet</h1>

      {/* Balance hero */}
      <div className="mb-6 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-900/20 to-amber-800/10 p-6">
        <p className="text-sm text-amber-400/70">Available Balance</p>
        {isLoading ? (
          <Spinner className="mt-2" />
        ) : (
          <p className="mt-1 text-4xl font-bold text-amber-400">
            {balance ? `${balance.currency} ${parseFloat(balance.balance).toFixed(2)}` : '—'}
          </p>
        )}
      </div>

      {/* Saved payment methods */}
      <div className="mb-6">
        <PaymentMethodManager />
      </div>

      {/* Forms grid */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <DepositCard />
        <WithdrawCard />
      </div>

      {/* Transaction history */}
      <TransactionHistory />
    </div>
  );
}
