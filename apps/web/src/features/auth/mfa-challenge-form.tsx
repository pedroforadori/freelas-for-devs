'use client';

import { unwrap } from '@f4d/api-client';
import type { Me } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Field, fieldA11y, Input } from '@f4d/ui/components/field';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

/** Segundo passo do login: código do app autenticador ou código de recuperação. */
export function MfaChallengeForm({
  challengeToken,
  onSignedIn,
}: {
  challengeToken: string;
  onSignedIn: (user: Me) => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await unwrap(
        api.POST('/v1/auth/mfa/verify', {
          body: useRecovery
            ? { challengeToken, recoveryCode: value }
            : { challengeToken, code: value.replace(/\s/g, '') },
        }),
      );
      onSignedIn(result.user);
    } catch (caught) {
      setError(errorMessage(caught));
      setValue('');
    } finally {
      setPending(false);
    }
  };

  const id = useRecovery ? 'recovery-code' : 'totp-code';
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id={id}
        label={useRecovery ? 'Código de recuperação' : 'Código do app autenticador'}
        hint={
          useRecovery
            ? 'Formato abcde-fghij. Cada código vale uma vez.'
            : 'Os 6 dígitos que aparecem agora no app.'
        }
      >
        <Input
          {...fieldA11y(id, undefined, true)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="one-time-code"
          inputMode={useRecovery ? 'text' : 'numeric'}
          maxLength={useRecovery ? 20 : 7}
          autoFocus
          required
        />
      </Field>
      <Button type="submit" disabled={pending || value.trim().length < 6}>
        {pending ? 'Verificando…' : 'Entrar'}
      </Button>
      <button
        type="button"
        className="self-start text-body underline"
        onClick={() => {
          setUseRecovery(!useRecovery);
          setValue('');
          setError(null);
        }}
      >
        {useRecovery
          ? 'Usar o código do app'
          : 'Perdeu o acesso ao app? Use um código de recuperação'}
      </button>
    </form>
  );
}
