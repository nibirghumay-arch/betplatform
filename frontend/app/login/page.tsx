'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      const res = await api.post('/auth/login', data);
      const user = res.data.user;
      setAuth({
        ...user,
        status: user.status ?? (user.isActive ? 'ACTIVE' : 'INACTIVE'),
        emailVerified: user.emailVerified ?? Boolean(user.emailVerifiedAt),
      }, res.data.accessToken);
      router.push('/lobby');
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="bg-gradient-to-r from-amber-200 via-white to-cyan-200 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent drop-shadow-lg">BetPlatform</h1>
          <p className="mt-1 text-sm text-slate-300">Sign in to your account</p>
        </div>
        <Card>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              error={errors.password?.message}
              {...register('password')}
            />
            {serverError && (
              <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
            )}
            <Button type="submit" size="lg" loading={isSubmitting} className="w-full mt-2">
              Sign In
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-gray-400">
            No account?{' '}
            <Link href="/register" className="text-cyan-200 hover:text-white hover:underline">
              Register
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
