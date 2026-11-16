'use client';

import { InputHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            'rounded-xl border bg-[#10172b]/80 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 transition focus:outline-none focus:ring-2 shadow-inner shadow-black/10',
            error
              ? 'border-red-500 focus:ring-red-500'
              : 'border-white/10 focus:border-amber-500 focus:ring-amber-500/30',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';
