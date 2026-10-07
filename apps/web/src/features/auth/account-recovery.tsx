'use client';

import { unwrap } from '@f4d/api-client';
import { forgotPasswordRequestSchema, resetPasswordRequestSchema } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button, buttonClasses } from '@f4d/ui/components/button';
import { Field, fieldA11y, Input } from '@f4d/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api, ensureCsrf } from '@/lib/api';
import { applyFieldErrors, errorMessage } from '@/lib/problem';
import { meQueryKey } from './session';

/** Confirma o e-mail assim que a página abre (link do e-mail). Executa uma única vez. */
export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const queryClient = useQueryClient();
  const [state, setState] = useState<'verifying' | 'done' | { error: string }>('verifying');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        await ensureCsrf();
        await unwrap(api.POST('/v1/auth/email/verify', { body: { token } }));
        await queryClient.invalidateQueries({ queryKey: meQueryKey });
        setState('done');
      } catch (error) {
        setState({ error: errorMessage(error) });
      }
    })();
  }, [token, queryClient]);

  if (state === 'verifying') return <p className="text-body">Confirmando seu e-mail…</p>;
  if (state === 'done') {
    return (
      <div className="flex flex-col gap-6">
        <Alert tone="success" title="E-mail confirmado!" />
        <Link href="/painel" className={buttonClasses('primary')}>
          Continuar
        </Link>
      </div>
    );
  }
  return (
    <Alert tone="error" title="Não foi possível confirmar">
      {state.error} Se você estiver logado, peça um novo link no painel.
    </Alert>
  );
}

type ForgotInput = z.input<typeof forgotPasswordRequestSchema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ForgotInput, unknown, z.output<typeof forgotPasswordRequestSchema>>({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await ensureCsrf();
      await unwrap(api.POST('/v1/auth/password/forgot', { body: values }));
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  if (sent) {
    return (
      <Alert tone="success" title="Confira seu e-mail">
        Se houver uma conta com este e-mail, você receberá um link para criar uma nova senha. O link
        vale por 1 hora.
      </Alert>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <Field id="email" label="E-mail da conta" error={errors.email?.message}>
        <Input
          {...fieldA11y('email', errors.email?.message)}
          type="email"
          autoComplete="email"
          {...form.register('email')}
        />
      </Field>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Enviando…' : 'Enviar link'}
      </Button>
      <Link href="/entrar" className="text-body underline">
        Voltar para entrar
      </Link>
    </form>
  );
}

type ResetInput = z.input<typeof resetPasswordRequestSchema>;

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetInput, unknown, z.output<typeof resetPasswordRequestSchema>>({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { token, password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await ensureCsrf();
      await unwrap(api.POST('/v1/auth/password/reset', { body: values }));
      // Todas as sessões foram encerradas pela API, inclusive esta.
      queryClient.setQueryData(meQueryKey, null);
      setDone(true);
    } catch (error) {
      if (!applyFieldErrors(error, form.setError)) setFormError(errorMessage(error));
    }
  });

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <Alert tone="success" title="Senha alterada">
          Por segurança, encerramos todas as sessões abertas. Entre com a nova senha.
        </Alert>
        <Link href="/entrar" className={buttonClasses('primary')}>
          Entrar
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      {errors.token ? <Alert tone="error">{errors.token.message}</Alert> : null}
      <Field
        id="password"
        label="Nova senha"
        hint="Ao menos 10 caracteres."
        error={errors.password?.message}
      >
        <Input
          {...fieldA11y('password', errors.password?.message, true)}
          type="password"
          autoComplete="new-password"
          {...form.register('password')}
        />
      </Field>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Salvando…' : 'Salvar nova senha'}
      </Button>
    </form>
  );
}
