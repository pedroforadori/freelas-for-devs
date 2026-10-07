'use client';

import { unwrap } from '@f4d/api-client';
import type { MfaSetupResponse } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Input } from '@f4d/ui/components/field';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { renderSVG } from 'uqr';
import { hasRole, meQueryKey, useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

/** QR como <img> (data URL): o SVG nunca entra no DOM como HTML. */
function QrCode({ value }: { value: string }) {
  const src = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(value, { border: 1 }))}`,
    [value],
  );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URL gerada localmente; otimização de imagem não se aplica
    <img
      src={src}
      alt="QR code para o app autenticador"
      width={208}
      height={208}
      className="rounded-[12px] border border-dark bg-white"
    />
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = `Freelas 4 Devs — códigos de recuperação\nCada código vale uma única vez.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: 'freelas4devs-codigos-de-recuperacao.txt',
    });
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card tone="accent" className="flex flex-col gap-4">
      <h3 className="text-h4 font-medium">Guarde seus códigos de recuperação</h3>
      <p className="text-body">
        Se perder o celular, use um destes códigos para entrar. Eles{' '}
        <strong>não serão mostrados de novo</strong>.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-body sm:grid-cols-5">
        {codes.map((code) => (
          <li key={code} className="rounded-pill border border-dark bg-bg px-2 py-1 text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={download}>
          Baixar .txt
        </Button>
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(text)}>
          Copiar
        </Button>
      </div>
    </Card>
  );
}

function EnableMfa() {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} />;

  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button
          className="self-start"
          disabled={pending}
          onClick={() =>
            void run(async () => setSetup(await unwrap(api.POST('/v1/auth/mfa/setup'))))
          }
        >
          Ativar verificação em duas etapas
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const result = await unwrap(
            api.POST('/v1/auth/mfa/enable', { body: { code: code.replace(/\s/g, '') } }),
          );
          queryClient.setQueryData(meQueryKey, result.user);
          setRecoveryCodes(result.recoveryCodes);
        });
      }}
    >
      <ol className="flex list-decimal flex-col gap-2 pl-6 text-body">
        <li>
          Instale um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password,
          Authy…).
        </li>
        <li>Leia o QR code abaixo com o app.</li>
        <li>Digite o código de 6 dígitos que aparecer.</li>
      </ol>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <QrCode value={setup.otpauthUrl} />
        <div className="text-sm">
          <p>Não consegue ler o QR? Digite esta chave no app:</p>
          <code className="mt-2 block break-all rounded-[12px] bg-surface p-3 font-mono">
            {setup.secret}
          </code>
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field id="mfa-code" label="Código do app">
        <Input
          {...fieldA11y('mfa-code')}
          className="max-w-48"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Button
        type="submit"
        className="self-start"
        disabled={pending || code.replace(/\s/g, '').length !== 6}
      >
        {pending ? 'Confirmando…' : 'Confirmar e ativar'}
      </Button>
    </form>
  );
}

function DisableMfa({ sessionAal }: { sessionAal: 1 | 2 }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (sessionAal < 2) {
    return (
      <p className="text-body text-muted">
        Para desativar, entre novamente usando o código do app.
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        void unwrap(api.POST('/v1/auth/mfa/disable', { body: { code: code.replace(/\s/g, '') } }))
          .then(() => queryClient.invalidateQueries({ queryKey: meQueryKey }))
          .catch((caught: unknown) => setError(errorMessage(caught)));
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field id="disable-code" label="Código atual do app para desativar">
        <Input
          {...fieldA11y('disable-code')}
          className="max-w-48"
          inputMode="numeric"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="outline" className="self-start">
        Desativar
      </Button>
    </form>
  );
}

export function SecurityPage() {
  const { me } = useSession();
  if (!me) return null;
  const isAdmin = hasRole(me, 'ADMIN');
  return (
    <>
      <SectionHeading title="Segurança">
        Proteja sua conta com um segundo fator além da senha.
      </SectionHeading>
      <Card tone="white" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-h4 font-medium">Verificação em duas etapas</h2>
          <Badge tone={me.mfaEnabled ? 'accent' : 'neutral'}>
            {me.mfaEnabled ? 'Ativa' : 'Inativa'}
          </Badge>
          {isAdmin ? <Badge tone="dark">Obrigatória para Admin</Badge> : null}
        </div>
        {me.mfaEnabled ? (
          isAdmin ? (
            <p className="text-body">Ativa e obrigatória para administradores.</p>
          ) : (
            <DisableMfa sessionAal={me.sessionAal} />
          )
        ) : (
          <EnableMfa />
        )}
      </Card>
    </>
  );
}
