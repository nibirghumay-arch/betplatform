'use client';

import { useState } from 'react';
import { useRevenueReport } from '@/hooks/useAdmin';
import type { RevenueRow } from '@/types';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function exportCsv(rows: RevenueRow[]) {
  if (!rows.length) return;
  const headers = ['Period', 'GGR', 'NGR', 'Total Deposits', 'Total Withdrawals'];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [r.period, r.ggr, r.ngr, r.totalDeposits, r.totalWithdrawals].join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `revenue-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [fromInput, setFromInput] = useState(daysAgoStr(30));
  const [toInput, setToInput] = useState(todayStr());
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');

  // Applied values — only update when user clicks Run
  const [applied, setApplied] = useState({ from: daysAgoStr(30), to: todayStr(), groupBy: 'day' as 'day' | 'month' });

  const { data: rows = [], isLoading } = useRevenueReport(applied.from, applied.to, applied.groupBy);

  const totalGgr = rows.reduce((s, r) => s + parseFloat(r.ggr), 0);
  const totalNgr = rows.reduce((s, r) => s + parseFloat(r.ngr), 0);
  const totalDeposits = rows.reduce((s, r) => s + parseFloat(r.totalDeposits), 0);
  const totalWithdrawals = rows.reduce((s, r) => s + parseFloat(r.totalWithdrawals), 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Reports</h1>

      {/* Filter bar */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">From</label>
            <input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">To</label>
            <input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Group By</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'day' | 'month')}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="day">Day</option>
              <option value="month">Month</option>
            </select>
          </div>
          <Button onClick={() => setApplied({ from: fromInput, to: toInput, groupBy })}>
            Run Report
          </Button>
          {rows.length > 0 && (
            <Button variant="secondary" onClick={() => exportCsv(rows)}>
              Export CSV
            </Button>
          )}
        </div>
      </Card>

      {/* Summary totals */}
      {rows.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              { label: 'Total GGR', value: `$${totalGgr.toFixed(2)}`, color: 'text-green-400' },
              { label: 'Total NGR', value: `$${totalNgr.toFixed(2)}`, color: 'text-emerald-400' },
              { label: 'Total Deposits', value: `$${totalDeposits.toFixed(2)}`, color: 'text-blue-400' },
              { label: 'Total Withdrawals', value: `$${totalWithdrawals.toFixed(2)}`, color: 'text-orange-400' },
            ] as { label: string; value: string; color: string }[]
          ).map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-1 text-xs text-gray-500">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Data table */}
      <Card>
        <CardTitle>
          Revenue by {applied.groupBy === 'day' ? 'Day' : 'Month'}
        </CardTitle>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No revenue data for the selected period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4">Period</th>
                  <th className="pb-2 pr-4 text-right">GGR</th>
                  <th className="pb-2 pr-4 text-right">NGR</th>
                  <th className="pb-2 pr-4 text-right">Deposits</th>
                  <th className="pb-2 text-right">Withdrawals</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.period} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-2.5 pr-4 font-mono text-gray-300">{r.period}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-green-400">
                      ${r.ggr}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-emerald-400">
                      ${r.ngr}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-blue-400">
                      ${r.totalDeposits}
                    </td>
                    <td className="py-2.5 text-right font-mono text-orange-400">
                      ${r.totalWithdrawals}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
