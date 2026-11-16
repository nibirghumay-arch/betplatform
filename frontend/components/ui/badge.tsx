import clsx from 'clsx';

const variants: Record<string, string> = {
  COMPLETED: 'bg-emerald-400/10 text-emerald-300 border-emerald-300/25',
  PENDING: 'bg-amber-300/10 text-amber-200 border-amber-300/25',
  PENDING_REVIEW: 'bg-amber-300/10 text-amber-200 border-amber-300/25',
  PROCESSING: 'bg-sky-400/10 text-sky-200 border-sky-300/25',
  FAILED: 'bg-rose-400/10 text-rose-200 border-rose-300/25',
  CANCELLED: 'bg-slate-400/10 text-slate-300 border-slate-300/20',
  ACTIVE: 'bg-lime-300/10 text-lime-200 border-lime-300/25',
  WAGERING: 'bg-orange-300/10 text-orange-200 border-orange-300/25',
  UNREAD: 'bg-cyan-300/10 text-cyan-200 border-cyan-300/25',
  READ: 'bg-slate-400/10 text-slate-300 border-slate-300/20',
  DEFAULT: 'bg-violet-300/10 text-violet-200 border-violet-300/20',
};

export function Badge({ label }: { label: string }) {
  const cls = variants[label] ?? variants.DEFAULT;
  return (
    <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide', cls)}>
      {label}
    </span>
  );
}
