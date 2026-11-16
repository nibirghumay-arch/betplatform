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
  email: z.string().trim().email('Enter a valid email address').transform((value) => value.toLowerCase()),
  username: z.string().trim().toLowerCase().min(3, 'At least 3 characters').max(20, 'Maximum 20 characters'),
  password: z.string().min(8, 'At least 8 characters'),
});
type FormData = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      const response = await api.post('/auth/register', data);
      const user = response.data.user;
      setAuth({
        ...user,
        status: user.status ?? (user.isActive ? 'ACTIVE' : 'INACTIVE'),
        emailVerified: user.emailVerified ?? Boolean(user.emailVerifiedAt),
      }, response.data.accessToken);
      router.replace('/lobby');
    } catch (err) {
      setServerError(apiError(err));
    }
  };



  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="bg-gradient-to-r from-amber-200 via-white to-cyan-200 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent drop-shadow-lg">BetPlatform</h1>
          <p className="mt-1 text-sm text-slate-300">Create your account</p>
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
              label="Username"
              autoComplete="username"
              placeholder="coolplayer99"
              error={errors.username?.message}
              {...register('username')}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder="Min. 8 characters"
              error={errors.password?.message}
              {...register('password')}
            />
            <p className="-mt-2 text-xs text-gray-500">Your username must be unique. No email verification is required.</p>
            {serverError && (
              <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{serverError}</p>
            )}
            <Button type="submit" size="lg" loading={isSubmitting} className="w-full mt-2">
              Create Account
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="text-cyan-200 hover:text-white hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
