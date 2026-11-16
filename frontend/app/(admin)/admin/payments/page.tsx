'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useWithdrawalQueue, useApproveWithdrawal, useRejectWithdrawal } from '@/hooks/useAdmin';
import { api, apiError } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const WITHDRAWAL_STATUSES = ['PENDING_REVIEW', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED'];
const PROVIDERS = [
  { value: 'BKASH', label: 'bKash' },
  { value: 'NAGAD', label: 'Nagad' },
  { value: 'ROCKET', label: 'Rocket' },
  { value: 'UPAY', label: 'Upay' },
] as const;

type MainTab = 'deposits' | 'withdrawals' | 'gateway';
type DepositRow = {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  pspProvider: string;
  paymentChannel?: string | null;
  createdAt: string;
  user: { id: string; email: string; username: string };
  metadata?: { bdGateway?: { receivingNumber?: string; provider?: string } } | null;
};

type GatewaySettings = {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  providers: string[];
  minDepositBdt: number;
  maxDepositBdt: number;
  hasApiKey: boolean;
  apiKeyHint: string;
  hasApiSecret: boolean;
  hasWebhookSecret: boolean;
  encryptionReady: boolean;
  credentialsStoredEncrypted: boolean;
  source: string;
  webhookUrl: string | null;
  gatewayAdminUrl: string | null;
  currency: string;
};

type GatewayForm = {
  enabled: boolean;
  baseUrl: string;
  providers: string[];
  minDepositBdt: number;
  maxDepositBdt: number;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
};

export default function PaymentsPage() {
  const admin = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MainTab>('deposits');
  const [withdrawalStatus, setWithdrawalStatus] = useState('PENDING_REVIEW');
  const [withdrawalPage, setWithdrawalPage] = useState(0);
  const [depositStatus, setDepositStatus] = useState('PENDING_PAYMENT');
  const [depositPage, setDepositPage] = useState(0);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [settingsNotice, setSettingsNotice] = useState('');
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [gatewayForm, setGatewayForm] = useState<GatewayForm>({
    enabled: false,
    baseUrl: '',
    providers: ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'],
    minDepositBdt: 10,
    maxDepositBdt: 500000,
    apiKey: '',
    apiSecret: '',
    webhookSecret: '',
  });

  const { data: withdrawalQueue = [], isLoading: withdrawalsLoading } =
    useWithdrawalQueue(withdrawalStatus, withdrawalPage);
  const approve = useApproveWithdrawal();
  const reject = useRejectWithdrawal();

  const depositsQuery = useQuery<DepositRow[]>({
    queryKey: ['admin', 'deposits', depositStatus, depositPage],
    queryFn: () =>
      api.get('/admin/payment/deposits', {
        params: {
          status: depositStatus === 'ALL' ? undefined : depositStatus,
          skip: depositPage * 50,
          take: 50,
        },
      }).then((r) => r.data),
    enabled: tab === 'deposits',
    refetchInterval: 15000,
  });

  const gatewayQuery = useQuery<GatewaySettings>({
    queryKey: ['admin', 'bd-gateway-settings'],
    queryFn: () => api.get('/admin/payment/bdgateway').then((r) => r.data),
    enabled: tab === 'gateway',
    retry: false,
  });

  useEffect(() => {
    const settings = gatewayQuery.data;
    if (!settings) return;
    setGatewayForm((previous) => ({
      ...previous,
      enabled: settings.enabled,
      baseUrl: settings.baseUrl ?? '',
      providers: settings.providers ?? [],
      minDepositBdt: settings.minDepositBdt ?? 10,
      maxDepositBdt: settings.maxDepositBdt ?? 500000,
      apiKey: '',
      apiSecret: '',
      webhookSecret: '',
    }));
  }, [gatewayQuery.data]);

  const saveGateway = useMutation({
    mutationFn: (payload: GatewayForm) =>
      api.put('/admin/payment/bdgateway', payload).then((r) => r.data as GatewaySettings),
    onSuccess: () => {
      setSettingsError('');
      setSettingsNotice('Gateway settings saved successfully.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'bd-gateway-settings'] });
      queryClient.invalidateQueries({ queryKey: ['bd-gateway-options'] });
    },
    onError: (err) => {
      setSettingsNotice('');
      setSettingsError(apiError(err));
    },
  });

  const reconcileDeposit = useMutation({
    mutationFn: (id: string) => api.post(`/admin/payment/deposits/${id}/reconcile`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'deposits'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  const handleApprove = (id: string) => {
    if (!admin) return;
    approve.mutate({ id, adminId: admin.id });
  };

  const handleReject = () => {
    if (!admin || !rejectTarget) return;
    reject.mutate(
      { id: rejectTarget, adminId: admin.id, reason: rejectReason },
      {
        onSuccess: () => {
          setRejectTarget(null);
          setRejectReason('');
        },
      },
    );
  };

  const toggleProvider = (provider: string) => {
    setGatewayForm((current) => ({
      ...current,
      providers: current.providers.includes(provider)
        ? current.providers.filter((item) => item !== provider)
        : [...current.providers, provider],
    }));
  };

  const submitGateway = (event: FormEvent) => {
    event.preventDefault();
    setSettingsError('');
    setSettingsNotice('');
    if (gatewayForm.maxDepositBdt < gatewayForm.minDepositBdt) {
      setSettingsError('Maximum deposit must be greater than or equal to the minimum.');
      return;
    }
    saveGateway.mutate(gatewayForm);
  };

  const copyWebhook = async () => {
    const value = gatewayQuery.data?.webhookUrl;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 1800);
    } catch {
      setSettingsError('Could not copy the webhook URL.');
    }
  };

  const tabClass = (selected: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-semibold transition ${selected
      ? 'bg-indigo-600 text-white'
      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Payments</h1>
        <p className="mt-1 text-sm text-gray-500">Manage deposits, withdrawals and the private BetPlatform payment connection.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={tabClass(tab === 'deposits')} onClick={() => setTab('deposits')}>Deposit Requests</button>
        <button className={tabClass(tab === 'withdrawals')} onClick={() => setTab('withdrawals')}>Withdrawal Queue</button>
        <button className={tabClass(tab === 'gateway')} onClick={() => setTab('gateway')}>Gateway Setup</button>
      </div>

      {tab === 'deposits' && (
        <Card>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Deposit Requests</CardTitle>
            <select
              value={depositStatus}
              onChange={(event) => { setDepositStatus(event.target.value); setDepositPage(0); }}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            >
              <option value="PENDING_PAYMENT">Pending payment</option>
              <option value="PROCESSING">Processing</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="ALL">All deposits</option>
            </select>
          </div>
          {depositsQuery.isLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : depositsQuery.isError ? (
            <p className="py-8 text-center text-sm text-red-400">{apiError(depositsQuery.error)}</p>
          ) : (depositsQuery.data ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">No deposit requests found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-gray-500">
                    <th className="pb-3 pr-4">Customer</th>
                    <th className="pb-3 pr-4">Amount</th>
                    <th className="pb-3 pr-4">Method</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3">Gateway check</th>
                  </tr>
                </thead>
                <tbody>
                  {(depositsQuery.data ?? []).map((deposit) => (
                    <tr key={deposit.id} className="border-b border-white/5">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-white">{deposit.user?.username ?? 'Unknown user'}</p>
                        <p className="text-xs text-gray-500">{deposit.user?.email}</p>
                        <p className="mt-1 font-mono text-[10px] text-gray-600">{deposit.id.slice(0, 12)}…</p>
                      </td>
                      <td className="py-3 pr-4 font-mono text-amber-400">
                        {deposit.currency === 'BDT' ? '৳' : deposit.currency + ' '}
                        {Number(deposit.amount).toFixed(2)}
                      </td>
                      <td className="py-3 pr-4 text-gray-300">{deposit.paymentChannel || deposit.pspProvider}</td>
                      <td className="py-3 pr-4"><Badge label={deposit.status} /></td>
                      <td className="py-3 pr-4 whitespace-nowrap text-xs text-gray-500">{new Date(deposit.createdAt).toLocaleString()}</td>
                      <td className="py-3">
                        {deposit.pspProvider === 'bdgateway' && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(deposit.status) ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={reconcileDeposit.isPending}
                            onClick={() => reconcileDeposit.mutate(deposit.id)}
                          >
                            Check status
                          </Button>
                        ) : <span className="text-xs text-gray-600">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {reconcileDeposit.isError && <p className="mt-3 text-sm text-red-400">{apiError(reconcileDeposit.error)}</p>}
          <div className="mt-5 flex items-center justify-between text-xs text-gray-500">
            <span>Page {depositPage + 1} · refreshes every 15 seconds</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={depositPage === 0} onClick={() => setDepositPage((page) => page - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={(depositsQuery.data ?? []).length < 50} onClick={() => setDepositPage((page) => page + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'withdrawals' && (
        <Card>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <CardTitle>Withdrawal Queue</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {WITHDRAWAL_STATUSES.map((status) => (
                <button
                  key={status}
                  onClick={() => { setWithdrawalStatus(status); setWithdrawalPage(0); }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    withdrawalStatus === status
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {withdrawalsLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : withdrawalQueue.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No withdrawals with status {withdrawalStatus}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4">ID</th>
                    <th className="pb-2 pr-4">User</th>
                    <th className="pb-2 pr-4 text-right">Amount</th>
                    <th className="pb-2 pr-4">Provider</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Date</th>
                    {withdrawalStatus === 'PENDING_REVIEW' && <th className="pb-2">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {withdrawalQueue.map((withdrawal) => (
                    <tr key={withdrawal.id} className="border-b border-white/5 hover:bg-white/3">
                      <td className="py-2.5 pr-4 font-mono text-xs text-gray-500">{withdrawal.id.slice(0, 8)}…</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-gray-300">{withdrawal.userId.slice(0, 8)}…</td>
                      <td className="py-2.5 pr-4 text-right font-mono text-amber-400">{withdrawal.currency} {Number(withdrawal.amount).toFixed(2)}</td>
                      <td className="py-2.5 pr-4 text-xs text-gray-400">{withdrawal.pspProvider}</td>
                      <td className="py-2.5 pr-4"><Badge label={withdrawal.status} /></td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-xs text-gray-500">{new Date(withdrawal.createdAt).toLocaleDateString()}</td>
                      {withdrawalStatus === 'PENDING_REVIEW' && (
                        <td className="py-2.5">
                          <div className="flex gap-2">
                            <Button size="sm" loading={approve.isPending} onClick={() => handleApprove(withdrawal.id)}>Approve</Button>
                            <Button size="sm" variant="danger" onClick={() => setRejectTarget(withdrawal.id)}>Reject</Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Page {withdrawalPage + 1}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={withdrawalPage === 0} onClick={() => setWithdrawalPage((page) => page - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={withdrawalQueue.length < 20} onClick={() => setWithdrawalPage((page) => page + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'gateway' && (
        <div className="space-y-4">
          {gatewayQuery.isLoading ? (
            <Card><div className="flex justify-center py-12"><Spinner /></div></Card>
          ) : gatewayQuery.isError ? (
            <Card><p className="text-sm text-red-400">{apiError(gatewayQuery.error)}</p></Card>
          ) : (
            <>
              <Card>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Private BD Payment Gateway</CardTitle>
                    <p className="max-w-2xl text-sm text-gray-400">This connects BetPlatform to your gateway using a private merchant credential. Only this backend calls the gateway API.</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${gatewayQuery.data?.enabled && gatewayQuery.data?.configured ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-300'}`}>
                    {gatewayQuery.data?.enabled && gatewayQuery.data?.configured ? 'Connected · Enabled' : 'Not active'}
                  </span>
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">Merchant API key</p>
                    <p className="mt-1 text-sm text-white">{gatewayQuery.data?.apiKeyHint || 'Not configured'}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">API secret</p>
                    <p className="mt-1 text-sm text-white">{gatewayQuery.data?.hasApiSecret ? 'Saved · hidden' : 'Not configured'}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">Webhook secret</p>
                    <p className="mt-1 text-sm text-white">{gatewayQuery.data?.hasWebhookSecret ? 'Saved · hidden' : 'Not configured'}</p>
                  </div>
                </div>

                {!gatewayQuery.data?.encryptionReady && (
                  <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-300">
                    Before saving credentials here, set PAYMENT_CONFIG_ENCRYPTION_KEY in your backend hosting environment. Generate it once with openssl rand -hex 32. Do not put it in frontend variables or Git.
                  </p>
                )}

                <form onSubmit={submitGateway} className="space-y-5">
                  <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                    <input
                      type="checkbox"
                      checked={gatewayForm.enabled}
                      onChange={(event) => setGatewayForm((form) => ({ ...form, enabled: event.target.checked }))}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-white">Enable this payment method</span>
                      <span className="block text-xs text-gray-500">Customers will see this option in their Wallet only when the connection is configured.</span>
                    </span>
                  </label>

                  <div>
                    <label className="mb-1 block text-sm text-gray-300">Gateway base URL</label>
                    <input
                      required
                      type="url"
                      value={gatewayForm.baseUrl}
                      onChange={(event) => setGatewayForm((form) => ({ ...form, baseUrl: event.target.value }))}
                      placeholder="https://your-payment-gateway.netlify.app"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold text-white">Accepted payment providers</p>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {PROVIDERS.map((provider) => (
                        <label key={provider.value} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={gatewayForm.providers.includes(provider.value)}
                            onChange={() => toggleProvider(provider.value)}
                            className="accent-amber-500"
                          />
                          {provider.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm text-gray-300">Minimum deposit (BDT)</label>
                      <input type="number" min={10} max={500000} value={gatewayForm.minDepositBdt}
                        onChange={(event) => setGatewayForm((form) => ({ ...form, minDepositBdt: Number(event.target.value) }))}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-gray-300">Maximum deposit (BDT)</label>
                      <input type="number" min={10} max={500000} value={gatewayForm.maxDepositBdt}
                        onChange={(event) => setGatewayForm((form) => ({ ...form, maxDepositBdt: Number(event.target.value) }))}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Private merchant credentials</p>
                      <p className="mt-1 text-xs text-gray-400">Create one merchant for BetPlatform in the gateway operator dashboard. Paste its credentials here. Values are encrypted before database storage. Leave a field blank to keep the current saved value.</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-gray-300">Merchant API key</label>
                      <input autoComplete="off" value={gatewayForm.apiKey}
                        onChange={(event) => setGatewayForm((form) => ({ ...form, apiKey: event.target.value }))}
                        placeholder={gatewayQuery.data?.hasApiKey ? 'Saved — leave blank to keep' : 'pk_…'}
                        className="w-full rounded-lg border border-white/10 bg-[#0b0b12] px-3 py-2 text-sm text-white" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-gray-300">Merchant API secret</label>
                      <input autoComplete="new-password" type="password" value={gatewayForm.apiSecret}
                        onChange={(event) => setGatewayForm((form) => ({ ...form, apiSecret: event.target.value }))}
                        placeholder={gatewayQuery.data?.hasApiSecret ? 'Saved — leave blank to keep' : 'sk_…'}
                        className="w-full rounded-lg border border-white/10 bg-[#0b0b12] px-3 py-2 text-sm text-white" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-gray-300">Webhook signing secret</label>
                      <input autoComplete="new-password" type="password" value={gatewayForm.webhookSecret}
                        onChange={(event) => setGatewayForm((form) => ({ ...form, webhookSecret: event.target.value }))}
                        placeholder={gatewayQuery.data?.hasWebhookSecret ? 'Saved — leave blank to keep' : 'whsec_…'}
                        className="w-full rounded-lg border border-white/10 bg-[#0b0b12] px-3 py-2 text-sm text-white" />
                    </div>
                  </div>

                  {settingsError && <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{settingsError}</p>}
                  {settingsNotice && <p className="rounded-lg bg-green-900/20 px-3 py-2 text-sm text-green-300">{settingsNotice}</p>}

                  <Button type="submit" loading={saveGateway.isPending}>Save gateway settings</Button>
                </form>
              </Card>

              <Card>
                <CardTitle>Webhook connection</CardTitle>
                <p className="mb-2 text-sm text-gray-400">Register this webhook URL in your gateway merchant settings. It sends payment status updates directly to BetPlatform's backend.</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-black/30 p-3 text-xs text-indigo-300">{gatewayQuery.data?.webhookUrl || 'Set API_PUBLIC_URL on the backend to generate this URL.'}</code>
                  <Button size="sm" variant="secondary" disabled={!gatewayQuery.data?.webhookUrl} onClick={copyWebhook}>{copiedWebhook ? 'Copied' : 'Copy URL'}</Button>
                </div>
                <div className="mt-4 rounded-lg bg-white/5 p-3 text-xs leading-5 text-gray-400">
                  <p>Receiving numbers and Android SMS-forwarder device keys are still administered in the gateway operator system. Its current merchant API does not expose receiving-account management. Customers will not receive the gateway admin URL or credentials.</p>
                  {gatewayQuery.data?.gatewayAdminUrl && (
                    <a href={gatewayQuery.data.gatewayAdminUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-amber-400 hover:underline">Gateway operator login (admin only)</a>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#16161f] p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-white">Reject Withdrawal</h3>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Reason for rejection..."
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
              rows={3}
            />
            <div className="mt-4 flex gap-3">
              <Button variant="danger" loading={reject.isPending} onClick={handleReject} className="flex-1">Reject</Button>
              <Button variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason(''); }} className="flex-1">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
