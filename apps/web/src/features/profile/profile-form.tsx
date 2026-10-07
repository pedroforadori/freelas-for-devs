'use client';

import { unwrap } from '@f4d/api-client';
import {
  type FreelancerProfile,
  freelancerProfileInputSchema,
  PROFILE_LIMITS,
  PROJECT_TYPE_LABELS,
  type ProjectType,
  type Stack,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Field, fieldA11y, Input, Textarea } from '@f4d/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { compact } from '@/lib/compact';
import { applyFieldErrors, errorMessage } from '@/lib/problem';
import { ChipGroup } from './chips';
import { useSetFreelancerProfile } from './queries';

type Input = z.input<typeof freelancerProfileInputSchema>;
type Output = z.output<typeof freelancerProfileInputSchema>;

const CATEGORY_LABELS: Record<Stack['category'], string> = {
  frontend: 'Front-end',
  backend: 'Back-end',
  mobile: 'Mobile',
  cms: 'CMS',
  ecommerce: 'E-commerce',
  database: 'Banco de dados',
  devops: 'Infra e deploy',
  design: 'Design',
};

/** Campo vazio vira "não informado" (o schema exige URL válida quando presente). */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export function ProfileForm({ profile, stacks }: { profile: FreelancerProfile; stacks: Stack[] }) {
  const setProfile = useSetFreelancerProfile();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );

  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(freelancerProfileInputSchema),
    defaultValues: {
      headline: profile.headline,
      bio: profile.bio,
      stacks: profile.stacks,
      projectTypes: profile.projectTypes,
      links: profile.links,
      available: profile.available,
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const bio = useWatch({ control: form.control, name: 'bio' }) ?? '';

  const onSubmit = form.handleSubmit(async (values) => {
    setFeedback(null);
    try {
      const updated = await unwrap(api.PUT('/v1/me/freelancer-profile', { body: compact(values) }));
      setProfile(updated);
      form.reset(values);
      setFeedback({ tone: 'success', text: 'Perfil salvo.' });
    } catch (error) {
      if (!applyFieldErrors(error, form.setError))
        setFeedback({ tone: 'error', text: errorMessage(error) });
    }
  });

  const byCategory = Object.entries(CATEGORY_LABELS)
    .map(([category, label]) => ({ label, items: stacks.filter((s) => s.category === category) }))
    .filter((group) => group.items.length > 0);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8" noValidate>
      <Field
        id="headline"
        label="Título"
        hint="Ex.: Dev front-end React e Next.js"
        error={errors.headline?.message}
      >
        <Input
          {...fieldA11y('headline', errors.headline?.message, true)}
          maxLength={PROFILE_LIMITS.headlineMax}
          {...form.register('headline')}
        />
      </Field>

      <Field
        id="bio"
        label="Apresentação"
        hint={`Conte o que você faz, como trabalha e com o que tem experiência. ${bio.length}/${PROFILE_LIMITS.bioMax} (mínimo ${PROFILE_LIMITS.bioMinToSubmit} para enviar)`}
        error={errors.bio?.message}
      >
        <Textarea
          {...fieldA11y('bio', errors.bio?.message, true)}
          rows={7}
          maxLength={PROFILE_LIMITS.bioMax}
          {...form.register('bio')}
        />
      </Field>

      <Controller
        control={form.control}
        name="projectTypes"
        render={({ field }) => (
          <ChipGroup<ProjectType>
            legend="Tipos de projeto que você faz"
            options={Object.entries(PROJECT_TYPE_LABELS).map(([value, label]) => ({
              value: value as ProjectType,
              label,
            }))}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={form.control}
        name="stacks"
        render={({ field }) => (
          <div className="flex flex-col gap-5">
            <p className="text-body font-medium">
              Stacks{' '}
              <span className="text-muted">
                ({field.value.length}/{PROFILE_LIMITS.stacksMax})
              </span>
            </p>
            {byCategory.map((group) => (
              <ChipGroup
                key={group.label}
                legend={group.label}
                options={group.items.map((s) => ({ value: s.slug, label: s.name }))}
                value={field.value}
                onChange={field.onChange}
                max={PROFILE_LIMITS.stacksMax}
              />
            ))}
          </div>
        )}
      />

      <div className="grid gap-5 md:grid-cols-3">
        <Field id="github" label="GitHub" error={errors.links?.github?.message}>
          <Input
            {...fieldA11y('github', errors.links?.github?.message)}
            placeholder="https://github.com/voce"
            {...form.register('links.github', { setValueAs: blankToUndefined })}
          />
        </Field>
        <Field id="linkedin" label="LinkedIn" error={errors.links?.linkedin?.message}>
          <Input
            {...fieldA11y('linkedin', errors.links?.linkedin?.message)}
            placeholder="https://linkedin.com/in/voce"
            {...form.register('links.linkedin', { setValueAs: blankToUndefined })}
          />
        </Field>
        <Field id="website" label="Site" error={errors.links?.website?.message}>
          <Input
            {...fieldA11y('website', errors.links?.website?.message)}
            placeholder="https://seusite.com.br"
            {...form.register('links.website', { setValueAs: blankToUndefined })}
          />
        </Field>
      </div>

      <label className="flex items-center gap-3 text-body">
        <input type="checkbox" className="size-5 accent-dark" {...form.register('available')} />
        Disponível para receber convites de projetos
      </label>

      {feedback ? <Alert tone={feedback.tone}>{feedback.text}</Alert> : null}
      <Button type="submit" className="self-start" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? 'Salvando…' : 'Salvar perfil'}
      </Button>
    </form>
  );
}
