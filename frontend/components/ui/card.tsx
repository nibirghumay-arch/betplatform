import clsx from 'clsx';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx('bp-card rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="bp-card-title mb-4 text-lg font-semibold sm:text-xl">{children}</h2>;
}
