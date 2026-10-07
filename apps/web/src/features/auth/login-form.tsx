'use client';

import { unwrap } from '@f4d/api-client';
import { loginRequestSchema, OAuthErrorReason } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Field, fieldA11y, Input } from '@f4d/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api, ensureCsrf } from '@/lib/api';
import { applyFieldErrors, errorMessage } from '@/lib/problem';
import { MfaChallengeForm } from './mfa-challenge-form';
import { Divider, OAuthButtons } from './oauth-buttons';
import { safeRedirect, useCompleteSignIn } from './session';

const OAUTH_ERRORS: Record<string, string> = {
  [OAuthErrorReason.Cancelled]: 'O login social foi cancelado.',
  [OAuthErrorReason.InvalidState]: 'O login social expirou. Tente novamente.',
  [OAuthErrorReason.ProviderFailed]:
    'Não conseguimos falar com o provedor. Tente novamente em instantes.',
  [OAuthErrorReason.EmailNotVerified]:
    'Seu e-mail não está verificado no provedor. Verifique-o lá ou cadastre-se com e-mail e senha.',
  [OAuthErrorReason.AccountSuspended]: 'Esta conta está suspensa. Fale com o suporte.',
};

type LoginInput = z.input<typeof loginRequestSchema>;
type LoginOutput = z.output<typeof loginRequestSchema>;

export function LoginForm() {
  const params = useSearchParams();
  const redirectTo = safeRedirect(params.get('redirectTo'));
  const completeSignIn = useCompleteSignIn();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(
    OAUTH_ERRORS[params.get('erro') ?? ''] ?? null,
  );

  const form = useForm<LoginInput, unknown, LoginOutput>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await ensureCsrf();
      const result = await unwrap(api.POST('/v1/auth/login', { body: values }));
      if (result.status === 'mfa_required') setChallenge(result.challengeToken);
      else completeSignIn(result.user, redirectTo);
    } catch (error) {
      if (!applyFieldErrors(error, form.setError)) setFormError(errorMessage(error));
    }
  });

  if (challenge) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body">Sua conta usa verificação em duas etapas.</p>
        <MfaChallengeForm
          challengeToken={challenge}
          onSignedIn={(user) => completeSignIn(user, redirectTo)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <OAuthButtons redirectTo={redirectTo} />
      <Divider />
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field id="email" label="E-mail" error={errors.email?.message}>
          <Input
            {...fieldA11y('email', errors.email?.message)}
            type="email"
            autoComplete="email"
            {...form.register('email')}
          />
        </Field>
        <Field id="password" label="Senha" error={errors.password?.message}>
          <Input
            {...fieldA11y('password', errors.password?.message)}
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      <div className="flex flex-col gap-2 text-body sm:flex-row sm:justify-between">
        <Link href="/esqueci-senha" className="underline">
          Esqueci minha senha
        </Link>
        <Link
          href={`/cadastro${redirectTo === '/painel' ? '' : `?redirectTo=${encodeURIComponent(redirectTo)}`}`}
          className="underline"
        >
          Criar conta
        </Link>
      </div>
    </div>
  );
}

/** Retorno do login social para contas com 2FA: o desafio chega no fragmento (#desafio=). */
export function OAuthMfaStep() {
  const completeSignIn = useCompleteSignIn();
  // undefined = ainda lendo o fragmento (só existe no browser; ler no render quebraria a hidratação).
  const [challenge, setChallenge] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setChallenge(new URLSearchParams(window.location.hash.slice(1)).get('desafio'));
    // Tira o desafio da barra de endereço (e do histórico) assim que ele é lido.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (challenge === undefined) return null;
  if (!challenge) {
    return (
      <Alert tone="error">
        Link de verificação inválido.{' '}
        <Link href="/entrar" className="underline">
          Entre novamente
        </Link>
        .
      </Alert>
    );
  }
  return (
    <MfaChallengeForm challengeToken={challenge} onSignedIn={(user) => completeSignIn(user)} />
  );
}
