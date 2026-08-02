'use client';

import { useAdminDashboard, useAdminSnapshots } from '@/hooks/useAdmin';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';

function StatCard({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <p className="mb-1 text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { data: stats, isLoading } = useAdminDashboard();
  const { data: snapshots = [] } = useAdminSnapshots(7);

  const snap = stats?.snapshot;

  const triggerSnapshot = async () => {
    try {
      await api.post('/admin/analytics/snapshot');
    } catch {
      /* no-op */
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <Button size="sm" variant="secondary" onClick={triggerSnapshot}>
          Take Snapshot
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-10 w-10" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total Players" value={snap?.totalPlayers ?? '—'} />
            <StatCard
              label="Active Sessions"
              value={stats?.activeSessions ?? '—'}
              color="text-indigo-400"
            />
            <StatCard
              label="GGR (last snapshot)"
              value={snap ? `$${parseFloat(snap.ggr).toFixed(2)}` : '—'}
              color="text-green-400"
            />
            <StatCard
              label="Deposits (last snapshot)"
              value={snap ? `$${parseFloat(snap.totalDeposits).toFixed(2)}` : '—'}
              color="text-blue-400"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Last snapshot detail */}
            <Card>
              <CardTitle>Last Snapshot</CardTitle>
              {!snap ? (
                <p className="text-sm text-gray-500">
                  No snapshot yet. Click &ldquo;Take Snapshot&rdquo; above.
                </p>
              ) : (
                <div className="space-y-3">
                  {(
                    [
                      ['Date', snap.snapshotDate],
                      ['New Signups', snap.newPlayers],
                      ['Active Players', snap.activePlayers],
                      ['Total Bets', snap.totalBets],
                      ['Total Withdrawals', `$${parseFloat(snap.totalWithdrawals).toFixed(2)}`],
                      ['GGR', `$${parseFloat(snap.ggr).toFixed(2)}`],
                    ] as [string, string | number][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">{k}</span>
                      <span className="font-medium text-white">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 7-day history table */}
            <Card>
              <CardTitle>7-Day History</CardTitle>
              {snapshots.length === 0 ? (
                <p className="text-sm text-gray-500">No historical snapshots yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-gray-500">
                        <th className="pb-2 pr-3">Date</th>
                        <th className="pb-2 pr-3 text-right">GGR</th>
                        <th className="pb-2 pr-3 text-right">Deposits</th>
                        <th className="pb-2 text-right">Players</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((s) => (
                        <tr key={s.snapshotDate} className="border-b border-white/5">
                          <td className="py-2 pr-3 text-gray-400">
                            {String(s.snapshotDate).slice(0, 10)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-green-400">
                            ${parseFloat(s.ggr).toFixed(2)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-blue-400">
                            ${parseFloat(s.totalDeposits).toFixed(2)}
                          </td>
                          <td className="py-2 text-right text-white">{s.totalPlayers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
