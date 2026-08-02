'use client';

import { useState } from 'react';
import { useAuditLogs } from '@/hooks/useAdmin';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { AuditLogEntry } from '@/types';

const PAGE_SIZE = 25;

const ACTION_FILTERS = [
  '',
  'LOGIN',
  'REGISTER',
  'DEPOSIT',
  'WITHDRAWAL_REQUEST',
  'WITHDRAWAL_APPROVE',
  'WITHDRAWAL_REJECT',
  'WALLET_FREEZE',
  'WALLET_UNFREEZE',
  'WALLET_DEACTIVATE',
  'BONUS_FORFEIT',
];

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useAuditLogs(action || undefined, page);
  const logs: AuditLogEntry[] = Array.isArray(data) ? data : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="hidden text-xs text-gray-500 sm:block">
          Requires{' '}
          <code className="text-indigo-400">GET /admin/audit</code> endpoint
        </p>
      </div>

      <Card>
        {/* Action filter pills */}
        <div className="mb-5 flex flex-wrap gap-1.5">
          {ACTION_FILTERS.map((a) => (
            <button
              key={a || 'all'}
              onClick={() => {
                setAction(a);
                setPage(0);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                action === a
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {a || 'All Actions'}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <p className="mb-2 text-sm text-red-400">Audit log endpoint not available.</p>
            <p className="text-xs text-gray-500">
              Add <code className="text-indigo-400">GET /admin/audit</code> to the NestJS backend
              (AuditController exposing AuditService.findAll).
            </p>
          </div>
        ) : logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No audit log entries found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4 whitespace-nowrap">Time</th>
                  <th className="pb-2 pr-4">Action</th>
                  <th className="pb-2 pr-4">Resource</th>
                  <th className="pb-2 pr-4">Resource ID</th>
                  <th className="pb-2">User ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-2.5 pr-4 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs font-medium text-indigo-400">
                      {log.action}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-300">{log.resource}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-gray-500">
                      {log.resourceId ? `${log.resourceId.slice(0, 10)}…` : '—'}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-gray-500">
                      {log.userId ? `${log.userId.slice(0, 10)}…` : '—'}
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
              disabled={logs.length < PAGE_SIZE}
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
