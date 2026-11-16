'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

// The self-hosted gateway only covers wallets the operator holds a SIM for.
const BD_GATEWAY_WALLETS: PaymentMethodType[] = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'];

interface BdGatewayOptions {
  enabled: boolean;
  providers: PaymentMethodType[];
  minDepositBdt: number;
  maxDepositBdt: number;
  currency: 'BDT';
}

const depositSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount').refine((v) => parseFloat(v) >= 10, 'Minimum ৳10'),
    pspProvider: z.string().min(1, 'Select a provider'),
    mobileGateway: z.string().optional(),
    bdProvider: z.string().optional(),
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
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);
  const { data: bdGatewayOptions } = useQuery<BdGatewayOptions>({
    queryKey: ['bd-gateway-options'],
    queryFn: () => api.get('/payment/bdgateway/options').then((r) => r.data),
  });
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<DepositForm>({
    resolver: zodResolver(depositSchema),
    defaultValues: { pspProvider: 'bdgateway', bdProvider: 'BKASH', mobileGateway: 'BKASH' },
  });
  const pspProvider = watch('pspProvider');

  const onSubmit = async (data: DepositForm) => {
    setServerError('');
    if (data.pspProvider === 'bdgateway' && !bdGatewayOptions?.enabled) {
      setServerError('The BetPlatform BD gateway has not been configured by the site administrator yet.');
      return;
    }
    try {
      const res = await api.post('/payment/deposit', {
        amount: parseFloat(data.amount),
        currency: 'BDT',
        pspProvider: data.pspProvider,
        ...(data.pspProvider === 'bdgateway' && { bdProvider: data.bdProvider }),
        ...(data.pspProvider === 'sslcommerz' && {
          mobileGateway: data.mobileGateway,
          customer: {
            name: user!.username,
            email: user!.email,
            phone: data.phone,
          },
        }),
      });
      if (res.data.paymentDetails && res.data.depositId) {
        reset();
        router.push(`/wallet/deposit/pay/${res.data.depositId}`);
        return;
      }
      if (res.data.checkoutUrl) {
        // Third-party PSPs (for example SSLCommerz) retain their hosted
        // checkout. BD gateway Send Money is completed inside BetPlatform.
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
              <option value="bdgateway" disabled={!bdGatewayOptions?.enabled}>
                {bdGatewayOptions?.enabled ? 'bKash / Nagad / Rocket / Upay — BetPlatform checkout' : 'BetPlatform BD gateway — not configured'}
              </option>
              <option value="sslcommerz">Mobile Banking / Card (SSLCommerz)</option>
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
            </select>
          </div>

          {pspProvider === 'bdgateway' && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">Send Money From</label>
              <select
                {...register('bdProvider')}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              >
                {(bdGatewayOptions?.providers?.length
                  ? bdGatewayOptions.providers
                  : BD_GATEWAY_WALLETS).map((w) => (
                  <option key={w} value={w}>{PAYMENT_METHOD_LABELS[w]}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                Your payment instructions and TrxID form will open inside BetPlatform. You will not
                need to visit the gateway operator&apos;s website.
                {bdGatewayOptions?.enabled
                  ? ` Deposit range: ৳${bdGatewayOptions.minDepositBdt.toLocaleString()}–৳${bdGatewayOptions.maxDepositBdt.toLocaleString()}.`
                  : ' The site administrator has not enabled this payment method yet.'}
              </p>
            </div>
          )}

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
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={isSubmitting || (pspProvider === 'bdgateway' && !bdGatewayOptions?.enabled)}
            className="w-full"
          >
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

// ─── Payment request tracking ───────────────────────────────────────────────

type CustomerDepositRequest = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  pspProvider: string;
  paymentChannel?: string | null;
  createdAt: string;
};

type CustomerWithdrawalRequest = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  pspProvider: string;
  createdAt: string;
};

function PaymentRequests() {
  const queryClient = useQueryClient();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState('');

  const deposits = useQuery<CustomerDepositRequest[]>({
    queryKey: ['payment-requests', 'deposits'],
    queryFn: () => api.get('/payment/deposit', { params: { take: 20 } }).then((r) => r.data),
    refetchInterval: 15000,
  });
  const withdrawals = useQuery<CustomerWithdrawalRequest[]>({
    queryKey: ['payment-requests', 'withdrawals'],
    queryFn: () => api.get('/payment/withdrawal', { params: { take: 20 } }).then((r) => r.data),
    refetchInterval: 15000,
  });

  const cancelWithdrawal = async (id: string) => {
    setCancellingId(id);
    setCancelError('');
    try {
      await api.post(`/payment/withdrawal/${id}/cancel`);
      await queryClient.invalidateQueries({ queryKey: ['payment-requests', 'withdrawals'] });
    } catch (err) {
      setCancelError(apiError(err));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Card className="col-span-full">
      <div className="mb-4">
        <CardTitle>Payment Requests</CardTitle>
        <p className="text-xs text-gray-500">Track your deposits and withdrawals inside BetPlatform. Status refreshes automatically.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Deposit requests</h3>
          {deposits.isLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : deposits.isError ? (
            <p className="py-4 text-sm text-red-400">{apiError(deposits.error)}</p>
          ) : (deposits.data ?? []).length === 0 ? (
            <p className="rounded-lg bg-white/5 px-3 py-4 text-sm text-gray-500">No deposit requests yet.</p>
          ) : (
            <div className="space-y-2">
              {(deposits.data ?? []).map((deposit) => (
                <div key={deposit.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-amber-400">
                      ৳{Number(deposit.amount).toFixed(2)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">{deposit.paymentChannel || deposit.pspProvider}</p>
                    <p className="mt-0.5 text-[10px] text-gray-600">{new Date(deposit.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge label={deposit.status.replace(/_/g, ' ')} />
                    {deposit.pspProvider === 'bdgateway' && ['PENDING_PAYMENT', 'PROCESSING'].includes(deposit.status) && (
                      <Link href={`/wallet/deposit/pay/${deposit.id}`}>
                        <Button size="sm" variant="secondary">Continue</Button>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Withdrawal requests</h3>
          {withdrawals.isLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : withdrawals.isError ? (
            <p className="py-4 text-sm text-red-400">{apiError(withdrawals.error)}</p>
          ) : (withdrawals.data ?? []).length === 0 ? (
            <p className="rounded-lg bg-white/5 px-3 py-4 text-sm text-gray-500">No withdrawal requests yet.</p>
          ) : (
            <div className="space-y-2">
              {(withdrawals.data ?? []).map((withdrawal) => (
                <div key={withdrawal.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-white">
                      ৳{Number(withdrawal.amount).toFixed(2)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">{withdrawal.pspProvider}</p>
                    <p className="mt-0.5 text-[10px] text-gray-600">{new Date(withdrawal.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge label={withdrawal.status.replace(/_/g, ' ')} />
                    {['PENDING_KYC', 'PENDING_REVIEW'].includes(withdrawal.status) && (
                      <Button size="sm" variant="ghost" loading={cancellingId === withdrawal.id} onClick={() => cancelWithdrawal(withdrawal.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {cancelError && <p className="mt-3 text-sm text-red-400">{cancelError}</p>}
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
                      ৳{parseFloat(tx.amount).toFixed(2)}
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
  const { data: balance, isLoading, isError: balanceError } = useBalance();

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Wallet</h1>

      {/* Balance hero */}
      <div className="mb-6 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-900/20 to-amber-800/10 p-6">
        <p className="text-sm text-amber-400/70">Available Balance (BDT)</p>
        {isLoading ? (
          <Spinner className="mt-2" />
        ) : (
          <p className="mt-1 text-4xl font-bold text-amber-400">
            {balance ? `৳ ${parseFloat(balance.balance).toFixed(2)}` : '—'}
          </p>
        )}
        {balanceError && (
          <p className="mt-2 text-xs text-red-400">
            Balance service is unavailable. Refresh the page or contact support if this continues.
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

      {/* Requests are tracked independently from ledger transactions. */}
      <div className="mb-6">
        <PaymentRequests />
      </div>

      {/* Transaction history */}
      <TransactionHistory />
    </div>
  );
}
