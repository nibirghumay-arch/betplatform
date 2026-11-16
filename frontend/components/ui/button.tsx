'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          'bp-button inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0d1224] disabled:opacity-50 disabled:cursor-not-allowed',
          {
            'bg-gradient-to-r from-violet-500 via-indigo-500 to-sky-500 text-white hover:from-violet-400 hover:via-indigo-400 hover:to-sky-400 focus:ring-violet-400 shadow-lg shadow-violet-950/30': variant === 'primary',
            'border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20 focus:ring-cyan-300/40': variant === 'secondary',
            'text-slate-200 hover:bg-violet-400/10 hover:text-violet-100 focus:ring-violet-300/30': variant === 'ghost',
            'bg-gradient-to-r from-rose-600 to-pink-500 text-white hover:from-rose-500 hover:to-pink-400 focus:ring-rose-400': variant === 'danger',
            'px-3 py-1.5 text-sm': size === 'sm',
            'px-4 py-2 text-sm': size === 'md',
            'px-6 py-3 text-base': size === 'lg',
          },
          className,
        )}
        {...props}
      >
        {loading ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
