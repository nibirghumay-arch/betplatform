'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useWithdrawalQueue, useApproveWithdrawal, useRejectWithdrawal } from '@/hooks/useAdmin';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const STATUSES = ['PENDING_REVIEW', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED'];

export default function PaymentsPage() {
  const admin = useAuthStore((s) => s.user);
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [page, setPage] = useState(0);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: queue = [], isLoading } = useWithdrawalQueue(status, page);
  const approve = useApproveWithdrawal();
  const reject = useRejectWithdrawal();

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

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Payments</h1>

      <Card>
        {/* Status filter tabs */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <CardTitle>Withdrawal Queue</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatus(s);
                  setPage(0);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  status === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : queue.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No withdrawals with status {status}.
          </p>
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
                  {status === 'PENDING_REVIEW' && <th className="pb-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {queue.map((w) => (
                  <tr key={w.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-2.5 pr-4 font-mono text-xs text-gray-500">
                      {w.id.slice(0, 8)}&hellip;
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-gray-300">
                      {w.userId.slice(0, 8)}&hellip;
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-amber-400">
                      {w.currency} {parseFloat(w.amount).toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-400">{w.pspProvider}</td>
                    <td className="py-2.5 pr-4">
                      <Badge label={w.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(w.createdAt).toLocaleDateString()}
                    </td>
                    {status === 'PENDING_REVIEW' && (
                      <td className="py-2.5">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            loading={approve.isPending}
                            onClick={() => handleApprove(w.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setRejectTarget(w.id)}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    )}
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
            <Button
              size="sm"
              variant="ghost"
              disabled={queue.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {/* Reject modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#16161f] p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-white">Reject Withdrawal</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
              rows={3}
            />
            <div className="mt-4 flex gap-3">
              <Button
                variant="danger"
                loading={reject.isPending}
                onClick={handleReject}
                className="flex-1"
              >
                Reject
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
