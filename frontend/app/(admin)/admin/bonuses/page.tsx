'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAdminBonusRules, useCreateBonusRule, useToggleBonusRule } from '@/hooks/useAdmin';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { apiError } from '@/lib/api';

const BONUS_TYPES = ['WELCOME', 'DEPOSIT', 'REFERRAL', 'PROMOTION', 'VIP_TIER', 'CASHBACK'];

const ruleSchema = z.object({
  name: z.string().min(1, 'Required'),
  bonusType: z.string().min(1, 'Required'),
  triggerEvent: z.string().min(1, 'Required'),
  configJson: z.string().min(2, 'Must be valid JSON'),
  priority: z.string().optional(),
  maxClaimsPerUser: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});
type RuleForm = z.infer<typeof ruleSchema>;

function CreateRuleForm({ onClose }: { onClose: () => void }) {
  const create = useCreateBonusRule();
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RuleForm>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      bonusType: 'WELCOME',
      configJson: '{"amount":"10","currency":"USD","wageringMultiplier":35}',
    },
  });

  const onSubmit = async (data: RuleForm) => {
    setServerError('');
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(data.configJson);
    } catch {
      setServerError('Config is not valid JSON');
      return;
    }
    try {
      await create.mutateAsync({
        name: data.name,
        bonusType: data.bonusType,
        triggerEvent: data.triggerEvent,
        config,
        priority: data.priority ? parseInt(data.priority, 10) : undefined,
        maxClaimsPerUser: data.maxClaimsPerUser ? parseInt(data.maxClaimsPerUser, 10) : undefined,
        startsAt: data.startsAt || undefined,
        endsAt: data.endsAt || undefined,
      });
      onClose();
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input label="Rule Name" error={errors.name?.message} {...register('name')} />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-300">Bonus Type</label>
        <select
          {...register('bonusType')}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          {BONUS_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <Input
        label="Trigger Event"
        placeholder="e.g. FIRST_DEPOSIT"
        error={errors.triggerEvent?.message}
        {...register('triggerEvent')}
      />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-300">Config (JSON)</label>
        <textarea
          {...register('configJson')}
          rows={3}
          className="resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white focus:border-indigo-500 focus:outline-none"
        />
        {errors.configJson && (
          <p className="text-xs text-red-400">{errors.configJson.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="Priority" type="number" placeholder="0" {...register('priority')} />
        <Input label="Max Claims / User" type="number" {...register('maxClaimsPerUser')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="Starts At" type="datetime-local" {...register('startsAt')} />
        <Input label="Ends At" type="datetime-local" {...register('endsAt')} />
      </div>

      {serverError && (
        <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
      )}

      <div className="flex gap-3">
        <Button type="submit" loading={isSubmitting} className="flex-1">
          Create Rule
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function BonusesPage() {
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const { data: rules = [], isLoading } = useAdminBonusRules(page);
  const toggle = useToggleBonusRule();

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Bonuses</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          + New Rule
        </Button>
      </div>

      {showCreate && (
        <Card className="mb-6">
          <CardTitle>Create Bonus Rule</CardTitle>
          <CreateRuleForm onClose={() => setShowCreate(false)} />
        </Card>
      )}

      <Card>
        <CardTitle>Bonus Rules</CardTitle>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : rules.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No bonus rules yet. Create one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Trigger</th>
                  <th className="pb-2 pr-4 text-center">Priority</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Toggle</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-2.5 pr-4 font-medium text-white">{rule.name}</td>
                    <td className="py-2.5 pr-4 text-xs text-indigo-400">{rule.bonusType}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-gray-400">
                      {rule.triggerEvent}
                    </td>
                    <td className="py-2.5 pr-4 text-center text-gray-300">
                      {rule.priority ?? 0}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge label={rule.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="py-2.5">
                      <Button
                        size="sm"
                        variant={rule.isActive ? 'danger' : 'secondary'}
                        loading={toggle.isPending}
                        onClick={() => toggle.mutate({ id: rule.id, active: !rule.isActive })}
                      >
                        {rule.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
          <span>Page {page + 1}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={rules.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
