'use client';

import { cn } from '@f4d/ui/cn';
import { Button } from '@f4d/ui/components/button';
import Link from 'next/link';
import Script from 'next/script';
import { type FormEvent, useState } from 'react';
import { rememberUtm } from '@/lib/utm';

type Profile = 'CLIENT' | 'FREELANCER';
type FieldErrors = Partial<Record<'name' | 'email' | 'mainStack' | 'consent', string>>;

interface Props {
  apiUrl: string;
  consentVersion: string;
  consentText: string;
  turnstileSiteKey: string | undefined;
}

/** Texto de um campo do formulário (FormData também pode conter arquivos). */
const field = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

const input =
  'w-full rounded-button border border-black bg-bg px-[30px] py-[18px] text-body placeholder:text-placeholder ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-dark focus-visible:ring-offset-2 aria-[invalid=true]:border-red-700';

/** Lista de espera: única ilha de JS da landing (além do UTM). Envia direto para a API. */
export function WaitlistForm({ apiUrl, consentVersion, consentText, turnstileSiteKey }: Props) {
  const [profile, setProfile] = useState<Profile>('CLIENT');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = field(data, 'name');
    const email = field(data, 'email');
    const nextErrors: FieldErrors = {};
    if (name.length < 2) nextErrors.name = 'Informe seu nome.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = 'Informe um e-mail válido.';
    if (data.get('consent') !== 'on')
      nextErrors.consent = 'É preciso concordar para entrar na lista.';
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setStatus('sending');
    try {
      const mainStack = field(data, 'mainStack');
      const captchaToken = field(data, 'cf-turnstile-response');
      const response = await fetch(`${apiUrl}/v1/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profile,
          name,
          email,
          ...(profile === 'FREELANCER' && mainStack ? { mainStack } : {}),
          consent: true,
          consentVersion,
          utm: rememberUtm(window.location.search),
          ...(captchaToken ? { captchaToken } : {}),
          website: field(data, 'website'),
        }),
      });
      if (response.ok) {
        setStatus('done');
        return;
      }
      const problem = (await response.json().catch(() => null)) as {
        detail?: string;
        errors?: { path: string; message: string }[];
      } | null;
      const fieldErrors: FieldErrors = {};
      for (const issue of problem?.errors ?? []) {
        fieldErrors[issue.path.replace(/^body\./, '') as keyof FieldErrors] = issue.message;
      }
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0)
        setFormError(problem?.detail ?? 'Não foi possível enviar agora. Tente de novo.');
    } catch {
      setFormError('Sem conexão. Verifique sua internet e tente de novo.');
    }
    setStatus('idle');
  };

  if (status === 'done') {
    return (
      <div
        role="status"
        className="flex max-w-[556px] flex-col gap-4 rounded-[24px] border border-dark bg-accent p-8"
      >
        <p className="text-h4 font-medium">Pronto, você está na lista!</p>
        <p className="text-body">
          Vamos avisar por e-mail assim que abrirmos{profile === 'FREELANCER' ? ' para devs' : ''}.
        </p>
      </div>
    );
  }

  const describedBy = (field: keyof FieldErrors) =>
    errors[field] ? `waitlist-${field}-error` : undefined;
  const errorText = (field: keyof FieldErrors) =>
    errors[field] ? (
      <p id={`waitlist-${field}-error`} role="alert" className="text-sm text-red-700">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex w-full max-w-[556px] flex-col gap-10"
    >
      <fieldset className="flex flex-wrap gap-[35px]">
        <legend className="sr-only">Você é</legend>
        {(
          [
            ['CLIENT', 'Quero contratar'],
            ['FREELANCER', 'Sou dev'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex cursor-pointer items-center gap-[14px] text-body">
            <input
              type="radio"
              name="profile"
              value={value}
              checked={profile === value}
              onChange={() => setProfile(value)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'grid size-7 place-items-center rounded-full border border-black bg-bg peer-focus-visible:ring-2 peer-focus-visible:ring-dark',
              )}
            >
              {profile === value ? <span className="size-4 rounded-full bg-accent" /> : null}
            </span>
            {label}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-[25px]">
        <div className="flex flex-col gap-[5px]">
          <label htmlFor="waitlist-name" className="text-base">
            Nome*
          </label>
          <input
            id="waitlist-name"
            name="name"
            autoComplete="name"
            placeholder="Seu nome"
            className={input}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('name')}
          />
          {errorText('name')}
        </div>
        <div className="flex flex-col gap-[5px]">
          <label htmlFor="waitlist-email" className="text-base">
            E-mail*
          </label>
          <input
            id="waitlist-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            className={input}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy('email')}
          />
          {errorText('email')}
        </div>
        {profile === 'FREELANCER' ? (
          <div className="flex flex-col gap-[5px]">
            <label htmlFor="waitlist-stack" className="text-base">
              Sua principal stack
            </label>
            <input
              id="waitlist-stack"
              name="mainStack"
              maxLength={60}
              placeholder="Ex.: React, Laravel, Flutter"
              className={input}
            />
          </div>
        ) : null}
        {/* Honeypot: invisível para pessoas, irresistível para robôs. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="waitlist-website">Não preencha</label>
          <input id="waitlist-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-3 text-base">
            <input
              type="checkbox"
              name="consent"
              className="mt-1 size-5 shrink-0 accent-dark"
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={describedBy('consent')}
            />
            <span>
              {consentText} Veja a{' '}
              <Link href="/privacidade" className="underline">
                política de privacidade
              </Link>
              .
            </span>
          </label>
          {errorText('consent')}
        </div>
      </div>

      {turnstileSiteKey ? (
        <>
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            strategy="lazyOnload"
          />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-language="pt-br" />
        </>
      ) : null}

      {formError ? (
        <p
          role="alert"
          className="rounded-[14px] border border-red-700 bg-red-50 px-5 py-3 text-body text-red-900"
        >
          {formError}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={status === 'sending'}>
        {status === 'sending' ? 'Enviando…' : 'Entrar na lista de espera'}
      </Button>
    </form>
  );
}
