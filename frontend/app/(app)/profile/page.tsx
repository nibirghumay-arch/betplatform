'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@/store/auth';
import { useVipProgress, useActiveBonuses, useBonusHistory } from '@/hooks/useProfile';
import { api, apiError } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

// ─── Personal info ─────────────────────────────────────────────────────────

const infoSchema = z.object({
  username: z.string().min(3).max(20),
  email: z.string().email(),
});
type InfoForm = z.infer<typeof infoSchema>;

function PersonalInfoCard() {
  const user = useAuthStore((s) => s.user);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<InfoForm>({
    defaultValues: { username: user?.username ?? '', email: user?.email ?? '' },
  });

  const onSubmit = async (data: InfoForm) => {
    setServerError('');
    setSuccess(false);
    try {
      await api.patch(`/users/${user!.id}`, data);
      setSuccess(true);
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <Card>
      <CardTitle>Personal Information</CardTitle>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Username" error={errors.username?.message} {...register('username')} />
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Status:</span>
          <Badge label={user?.status ?? 'ACTIVE'} />
          {user?.emailVerified && (
            <span className="text-xs text-green-400">✓ Email verified</span>
          )}
        </div>
        {success && <p className="text-xs text-green-400">Profile updated.</p>}
        {serverError && (
          <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
        )}
        <Button type="submit" loading={isSubmitting} disabled={!isDirty} className="w-full">
          Save Changes
        </Button>
      </form>
      {user?.referralCode && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/3 px-3 py-2">
          <p className="text-xs text-gray-500">Your referral code</p>
          <p className="font-mono text-sm font-bold text-amber-400">{user.referralCode}</p>
        </div>
      )}
    </Card>
  );
}

// ─── Change password ───────────────────────────────────────────────────────

const pwSchema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(8, 'At least 8 characters'),
  confirm: z.string(),
}).refine((d) => d.newPassword === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type PwForm = z.infer<typeof pwSchema>;

function ChangePasswordCard() {
  const user = useAuthStore((s) => s.user);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PwForm>({
    resolver: zodResolver(pwSchema),
  });

  const onSubmit = async (data: PwForm) => {
    setServerError('');
    setSuccess(false);
    try {
      await api.post('/auth/change-password', {
        userId: user!.id,
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      setSuccess(true);
      reset();
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <Card>
      <CardTitle>Change Password</CardTitle>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Current Password" type="password" error={errors.currentPassword?.message} {...register('currentPassword')} />
        <Input label="New Password" type="password" error={errors.newPassword?.message} {...register('newPassword')} />
        <Input label="Confirm New Password" type="password" error={errors.confirm?.message} {...register('confirm')} />
        {success && <p className="text-xs text-green-400">Password changed successfully.</p>}
        {serverError && (
          <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
        )}
        <Button type="submit" variant="secondary" loading={isSubmitting} className="w-full">
          Update Password
        </Button>
      </form>
    </Card>
  );
}

// ─── VIP level ─────────────────────────────────────────────────────────────

const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
const TIER_THRESHOLDS = [0, 1000, 5000, 20000, 100000]; // wagered USD
const TIER_COLORS = [
  'from-amber-700 to-amber-600',
  'from-gray-400 to-gray-300',
  'from-yellow-500 to-yellow-400',
  'from-sky-400 to-sky-300',
  'from-violet-500 to-violet-400',
];

function VipCard() {
  const { data: vip, isLoading } = useVipProgress();

  if (isLoading) return <Card><Spinner /></Card>;

  const tier = vip?.currentTier ?? 0;
  const tierName = TIER_NAMES[tier] ?? `Tier ${tier}`;
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS[0];
  const totalWager = parseFloat(vip?.totalWager ?? '0');
  const currentThreshold = TIER_THRESHOLDS[tier] ?? 0;
  const nextThreshold = TIER_THRESHOLDS[tier + 1];
  const progress = nextThreshold
    ? Math.min(100, ((totalWager - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
    : 100;

  return (
    <Card>
      <CardTitle>VIP Status</CardTitle>
      <div className={`mb-4 rounded-xl bg-gradient-to-r ${tierColor} px-4 py-3 text-black`}>
        <p className="text-xs font-medium opacity-70">Current Tier</p>
        <p className="text-2xl font-bold">{tierName}</p>
      </div>

      {nextThreshold ? (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-gray-400">
            <span>{tierName}</span>
            <span>{TIER_NAMES[tier + 1]}</span>
          </div>
          <div className="h-2 rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-amber-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 text-right">
            ${totalWager.toLocaleString()} / ${nextThreshold.toLocaleString()} wagered
          </p>
        </div>
      ) : (
        <p className="text-xs text-amber-400">Maximum tier achieved!</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-xs text-gray-500">Total Wagered</p>
          <p className="text-sm font-bold text-white">${parseFloat(vip?.totalWager ?? '0').toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-xs text-gray-500">Period Wagered</p>
          <p className="text-sm font-bold text-white">${parseFloat(vip?.periodWager ?? '0').toLocaleString()}</p>
        </div>
      </div>
    </Card>
  );
}

// ─── Bonuses ───────────────────────────────────────────────────────────────

function BonusesCard() {
  const { data: active = [], isLoading: loadingActive } = useActiveBonuses();
  const { data: history = [], isLoading: loadingHistory } = useBonusHistory();

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardTitle>Bonuses</CardTitle>

      {/* Active bonuses */}
      {loadingActive ? (
        <Spinner />
      ) : active.length > 0 ? (
        <div className="mb-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Active</p>
          {active.map((b) => {
            const total = parseFloat(b.wageringRequired);
            const done = parseFloat(b.wageringCompleted);
            const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
            return (
              <div key={b.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-semibold text-white">{b.bonusType}</span>
                    <span className="ml-2 text-sm font-bold text-amber-400">${parseFloat(b.amount).toFixed(2)}</span>
                  </div>
                  <Badge label={b.status} />
                </div>
                <div className="h-1.5 rounded-full bg-white/10">
                  <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Wagering: ${done.toFixed(2)} / ${total.toFixed(2)}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mb-4 text-sm text-gray-500">No active bonuses.</p>
      )}

      {/* History */}
      {!loadingHistory && history.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">History</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {history.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-white">{b.bonusType}</span>
                  <span className="ml-2 text-gray-400">${parseFloat(b.amount).toFixed(2)}</span>
                </div>
                <Badge label={b.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Profile</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <PersonalInfoCard />
        <VipCard />
        <ChangePasswordCard />
        <BonusesCard />
      </div>
    </div>
  );
}
