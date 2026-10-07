'use client';

import { unwrap } from '@f4d/api-client';
import {
  type FreelancerProfile,
  type PortfolioItemInput,
  portfolioItemInputSchema,
  PROFILE_LIMITS,
  type Stack,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Input, Textarea } from '@f4d/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { compact } from '@/lib/compact';
import { applyFieldErrors, errorMessage } from '@/lib/problem';
import { useSetFreelancerProfile } from './queries';

type Item = FreelancerProfile['portfolio'][number];

function ItemForm({ item, stacks, onDone }: { item?: Item; stacks: Stack[]; onDone: () => void }) {
  const setProfile = useSetFreelancerProfile();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof portfolioItemInputSchema>, unknown, PortfolioItemInput>({
    resolver: zodResolver(portfolioItemInputSchema),
    defaultValues: item
      ? { title: item.title, description: item.description, url: item.url, stacks: item.stacks }
      : { title: '', description: '', stacks: [] },
  });
  const { errors, isSubmitting } = form.formState;
  const prefix = item ? `item-${item.id}` : 'item-new';

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const profile = item
        ? await unwrap(
            api.PUT('/v1/me/freelancer-profile/portfolio/{itemId}', {
              params: { path: { itemId: item.id } },
              body: compact(values),
            }),
          )
        : await unwrap(api.POST('/v1/me/freelancer-profile/portfolio', { body: compact(values) }));
      setProfile(profile);
      onDone();
    } catch (caught) {
      if (!applyFieldErrors(caught, form.setError)) setError(errorMessage(caught));
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field id={`${prefix}-title`} label="Nome do projeto" error={errors.title?.message}>
        <Input
          {...fieldA11y(`${prefix}-title`, errors.title?.message)}
          {...form.register('title')}
        />
      </Field>
      <Field
        id={`${prefix}-description`}
        label="O que você fez"
        hint="Mínimo de 20 caracteres."
        error={errors.description?.message}
      >
        <Textarea
          {...fieldA11y(`${prefix}-description`, errors.description?.message, true)}
          rows={4}
          {...form.register('description')}
        />
      </Field>
      <Field id={`${prefix}-url`} label="Link (opcional)" error={errors.url?.message}>
        <Input
          {...fieldA11y(`${prefix}-url`, errors.url?.message)}
          placeholder="https://"
          {...form.register('url', {
            setValueAs: (v: string) => (v?.trim() ? v.trim() : undefined),
          })}
        />
      </Field>
      <Field
        id={`${prefix}-stacks`}
        label="Stacks usadas"
        hint="Segure Ctrl/Cmd para selecionar várias."
      >
        <select
          id={`${prefix}-stacks`}
          multiple
          className="min-h-36 rounded-button border border-dark p-3"
          {...form.register('stacks')}
        >
          {stacks.map((stack) => (
            <option key={stack.slug} value={stack.slug}>
              {stack.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando…' : 'Salvar item'}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function Portfolio({ profile, stacks }: { profile: FreelancerProfile; stacks: Stack[] }) {
  const setProfile = useSetFreelancerProfile();
  // id do item em edição, 'new' para um item novo, ou null.
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(stacks.map((s) => [s.slug, s.name]));

  const remove = async (item: Item) => {
    if (!window.confirm(`Remover "${item.title}" do portfólio?`)) return;
    try {
      setProfile(
        await unwrap(
          api.DELETE('/v1/me/freelancer-profile/portfolio/{itemId}', {
            params: { path: { itemId: item.id } },
          }),
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <section aria-labelledby="portfolio-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="portfolio-title" className="text-h3 font-medium">
          Portfólio{' '}
          <span className="text-body text-muted">
            ({profile.portfolio.length}/{PROFILE_LIMITS.portfolioMax})
          </span>
        </h2>
        {editing === null && profile.portfolio.length < PROFILE_LIMITS.portfolioMax ? (
          <Button variant="outline" onClick={() => setEditing('new')}>
            Adicionar projeto
          </Button>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {editing === 'new' ? (
        <Card tone="surface">
          <ItemForm stacks={stacks} onDone={() => setEditing(null)} />
        </Card>
      ) : null}
      {profile.portfolio.length === 0 && editing !== 'new' ? (
        <p className="text-body text-muted">
          Mostre projetos reais — mesmo pessoais ou de estudo. É o que os clientes mais olham.
        </p>
      ) : null}
      <ul className="grid gap-5 md:grid-cols-2">
        {profile.portfolio.map((item) => (
          <li key={item.id}>
            <Card tone="white" className="flex h-full flex-col gap-3">
              {editing === item.id ? (
                <ItemForm item={item} stacks={stacks} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <h3 className="text-h4 font-medium">{item.title}</h3>
                  <p className="text-body">{item.description}</p>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow ugc"
                      className="break-all underline"
                    >
                      {item.url}
                    </a>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {item.stacks.map((slug) => (
                      <Badge key={slug}>{names.get(slug) ?? slug}</Badge>
                    ))}
                  </div>
                  <div className="mt-auto flex gap-4 pt-2">
                    <button type="button" className="underline" onClick={() => setEditing(item.id)}>
                      Editar
                    </button>
                    <button type="button" className="underline" onClick={() => void remove(item)}>
                      Remover
                    </button>
                  </div>
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
