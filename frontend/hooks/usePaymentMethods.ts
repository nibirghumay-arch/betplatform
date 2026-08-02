import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { PaymentMethod, PaymentMethodType } from '@/types';

export function usePaymentMethods() {
  const user = useAuthStore((s) => s.user);
  return useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods', user?.id],
    queryFn: () =>
      api.get('/payment/methods', { params: { userId: user!.id } }).then((r) => r.data),
    enabled: !!user,
  });
}

export interface CreatePaymentMethodInput {
  type: PaymentMethodType;
  accountNumber: string;
  accountHolder?: string;
  bankName?: string;
  branchName?: string;
  routingNumber?: string;
  label?: string;
  makeDefault?: boolean;
}

export function useAddPaymentMethod() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePaymentMethodInput) =>
      api
        .post('/payment/methods', input, { params: { userId: user!.id } })
        .then((r) => r.data as PaymentMethod),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods', user?.id] });
    },
  });
}

export function useSetDefaultPaymentMethod() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api
        .patch(`/payment/methods/${id}/default`, {}, { params: { userId: user!.id } })
        .then((r) => r.data as PaymentMethod),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods', user?.id] });
    },
  });
}

export function useRemovePaymentMethod() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/payment/methods/${id}`, { params: { userId: user!.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods', user?.id] });
    },
  });
}
