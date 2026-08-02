'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2, Check, Star } from 'lucide-react';
import clsx from 'clsx';
import {
  usePaymentMethods,
  useAddPaymentMethod,
  useSetDefaultPaymentMethod,
  useRemovePaymentMethod,
} from '@/hooks/usePaymentMethods';
import { apiError } from '@/lib/api';
import { PaymentMethodType, PAYMENT_METHOD_LABELS } from '@/types';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

const MOBILE_WALLET_OPTIONS: PaymentMethodType[] = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY', 'MCASH', 'TAP'];

const addMethodSchema = z.object({
  type: z.enum(['BKASH', 'NAGAD', 'ROCKET', 'UPAY', 'MCASH', 'TAP']),
  accountNumber: z
    .string()
    .regex(/^01[3-9]\d{8}$/, 'Enter an 11-digit BD mobile number, e.g. 01712345678'),
  accountHolder: z.string().optional(),
  label: z.string().optional(),
  makeDefault: z.boolean().optional(),
});
type AddMethodForm = z.infer<typeof addMethodSchema>;

/** Small colored initial-letter badge so each wallet type is visually
 * distinguishable at a glance in the list (bKash pink, Nagad orange, etc. —
 * loosely echoing each brand's real accent without reproducing their logos). */
function WalletIcon({ type }: { type: PaymentMethodType }) {
  const styles: Record<string, string> = {
    BKASH: 'bg-pink-600/20 text-pink-400 border-pink-600/30',
    NAGAD: 'bg-orange-600/20 text-orange-400 border-orange-600/30',
    ROCKET: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
    UPAY: 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30',
    MCASH: 'bg-teal-600/20 text-teal-400 border-teal-600/30',
    TAP: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30',
    BANK: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    CARD: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
  };
  return (
    <span
      className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
        styles[type] ?? styles.BANK,
      )}
    >
      {PAYMENT_METHOD_LABELS[type].slice(0, 2).toUpperCase()}
    </span>
  );
}

function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `${'•'.repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`;
}

export function PaymentMethodManager() {
  const { data: methods = [], isLoading } = usePaymentMethods();
  const addMethod = useAddPaymentMethod();
  const setDefault = useSetDefaultPaymentMethod();
  const removeMethod = useRemovePaymentMethod();
  const [showAddForm, setShowAddForm] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddMethodForm>({
    resolver: zodResolver(addMethodSchema),
    defaultValues: { type: 'BKASH' },
  });

  const onSubmit = async (data: AddMethodForm) => {
    setServerError('');
    try {
      await addMethod.mutateAsync(data);
      reset();
      setShowAddForm(false);
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <CardTitle>Payment Methods</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? 'Cancel' : '+ Add Account'}
        </Button>
      </div>

      <p className="mb-4 text-xs text-gray-500">
        Save bKash, Nagad, Rocket, Upay, mCash, or Tap accounts. You can keep several on file —
        only one is active at a time, but you can switch which one any time.
      </p>

      {showAddForm && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mb-5 space-y-4 rounded-lg border border-white/10 bg-black/20 p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Wallet Type</label>
            <select
              {...register('type')}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              {MOBILE_WALLET_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {PAYMENT_METHOD_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Mobile Number"
            placeholder="01712345678"
            error={errors.accountNumber?.message}
            {...register('accountNumber')}
          />

          <Input
            label="Account Holder Name (optional)"
            placeholder="Jane Doe"
            {...register('accountHolder')}
          />

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" {...register('makeDefault')} className="rounded border-white/20 bg-white/5" />
            Make this my active payment method
          </label>

          {serverError && (
            <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
          )}

          <Button type="submit" loading={isSubmitting} className="w-full">
            Save Account
          </Button>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : methods.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          No payment methods saved yet. Add a bKash, Nagad, Rocket, or Upay account to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {methods.map((m) => (
            <li
              key={m.id}
              className={clsx(
                'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition',
                m.isDefault ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/5',
              )}
            >
              <div className="flex items-center gap-3">
                <WalletIcon type={m.type} />
                <div>
                  <p className="text-sm font-medium text-white">
                    {m.label || PAYMENT_METHOD_LABELS[m.type]}
                    {m.isDefault && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-amber-400">
                        <Star size={11} fill="currentColor" /> Active
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-gray-500">{maskAccountNumber(m.accountNumber)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!m.isDefault && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={setDefault.isPending}
                    onClick={() => setDefault.mutate(m.id)}
                    title="Make active"
                  >
                    <Check size={14} className="mr-1" /> Use this
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-400 hover:bg-red-900/20"
                  loading={removeMethod.isPending}
                  onClick={() => removeMethod.mutate(m.id)}
                  title="Remove"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
