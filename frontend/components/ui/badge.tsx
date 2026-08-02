import clsx from 'clsx';

const variants: Record<string, string> = {
  COMPLETED: 'bg-green-900/50 text-green-300 border-green-700',
  PENDING: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  PENDING_REVIEW: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  PROCESSING: 'bg-blue-900/50 text-blue-300 border-blue-700',
  FAILED: 'bg-red-900/50 text-red-300 border-red-700',
  CANCELLED: 'bg-gray-800 text-gray-400 border-gray-600',
  ACTIVE: 'bg-green-900/50 text-green-300 border-green-700',
  WAGERING: 'bg-amber-900/50 text-amber-300 border-amber-700',
  UNREAD: 'bg-blue-900/50 text-blue-300 border-blue-700',
  READ: 'bg-gray-800 text-gray-400 border-gray-600',
  DEFAULT: 'bg-white/10 text-gray-300 border-white/20',
};

export function Badge({ label }: { label: string }) {
  const cls = variants[label] ?? variants.DEFAULT;
  return (
    <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', cls)}>
      {label}
    </span>
  );
}
