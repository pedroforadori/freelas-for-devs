'use client';

import { unwrap } from '@f4d/api-client';
import { registerRequestSchema, type SelfAssignableRole } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { cn } from '@f4d/ui/cn';
import { Field, fieldA11y, Input } from '@f4d/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { api, ensureCsrf } from '@/lib/api';
import { applyFieldErrors, errorMessage } from '@/lib/problem';
import { Divider, OAuthButtons } from './oauth-buttons';
import { safeRedirect, useCompleteSignIn } from './session';

type RegisterInput = z.input<typeof registerRequestSchema>;
type RegisterOutput = z.output<typeof registerRequestSchema>;

const ROLES: { value: SelfAssignableRole; title: string; description: string }[] = [
  {
    value: 'CLIENT',
    title: 'Quero contratar',
    description: 'Tenho um projeto e preciso de um dev.',
  },
  {
    value: 'FREELANCER',
    title: 'Quero trabalhar',
    description: 'Sou dev e quero receber projetos.',
  },
];

export function RegisterForm() {
  const params = useSearchParams();
  const completeSignIn = useCompleteSignIn();
  const [formError, setFormError] = useState<string | null>(null);
  const initialRole: SelfAssignableRole =
    params.get('perfil') === 'freelancer' ? 'FREELANCER' : 'CLIENT';
  const redirectTo = safeRedirect(
    params.get('redirectTo'),
    initialRole === 'FREELANCER' ? '/perfil' : '/painel',
  );

  const form = useForm<RegisterInput, unknown, RegisterOutput>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { email: '', password: '', displayName: '', role: initialRole },
  });
  const { errors, isSubmitting } = form.formState;
  const role = useWatch({ control: form.control, name: 'role' });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await ensureCsrf();
      const result = await unwrap(api.POST('/v1/auth/register', { body: values }));
      completeSignIn(result.user, values.role === 'FREELANCER' ? '/perfil' : redirectTo);
    } catch (error) {
      if (!applyFieldErrors(error, form.setError)) setFormError(errorMessage(error));
    }
  });

  return (
    <div className="flex flex-col gap-6">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Como você vai usar a plataforma?</legend>
        {ROLES.map((option) => (
          <label
            key={option.value}
            className={cn(
              'cursor-pointer rounded-[20px] border border-dark p-4 transition',
              role === option.value ? 'bg-accent shadow-brutal' : 'bg-bg hover:bg-surface',
            )}
          >
            <input
              type="radio"
              value={option.value}
              className="sr-only"
              {...form.register('role')}
            />
            <span className="block font-medium">{option.title}</span>
            <span className="block text-sm">{option.description}</span>
          </label>
        ))}
      </fieldset>

      <OAuthButtons role={role} redirectTo={role === 'FREELANCER' ? '/perfil' : redirectTo} />
      <p className="-mt-3 text-sm text-muted">
        Ao continuar com GitHub ou Google você aceita os{' '}
        <Link href="/termos" className="underline">
          termos de uso
        </Link>{' '}
        e a{' '}
        <Link href="/privacidade" className="underline">
          política de privacidade
        </Link>
        .
      </p>
      <Divider />

      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field id="displayName" label="Nome" error={errors.displayName?.message}>
          <Input
            {...fieldA11y('displayName', errors.displayName?.message)}
            autoComplete="name"
            {...form.register('displayName')}
          />
        </Field>
        <Field id="email" label="E-mail" error={errors.email?.message}>
          <Input
            {...fieldA11y('email', errors.email?.message)}
            type="email"
            autoComplete="email"
            {...form.register('email')}
          />
        </Field>
        <Field
          id="password"
          label="Senha"
          hint="Ao menos 10 caracteres. Uma frase é uma ótima senha."
          error={errors.password?.message}
        >
          <Input
            {...fieldA11y('password', errors.password?.message, true)}
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
          />
        </Field>
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-3 text-body">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-dark"
              {...form.register('acceptTerms')}
            />
            <span>
              Li e aceito os{' '}
              <Link href="/termos" className="underline">
                termos de uso
              </Link>{' '}
              e a{' '}
              <Link href="/privacidade" className="underline">
                política de privacidade
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms ? (
            <p role="alert" className="text-sm text-red-700">
              {errors.acceptTerms.message}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Criando conta…' : 'Criar conta'}
        </Button>
      </form>
      <p className="text-body">
        Já tem conta?{' '}
        <Link href="/entrar" className="underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
