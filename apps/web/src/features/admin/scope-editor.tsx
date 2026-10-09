'use client';

import { unwrap } from '@f4d/api-client';
import {
  type AdminProjectDetail,
  PROJECT_TYPE_LABELS,
  type ProjectType,
  type ScopeInput,
  scopeInputSchema,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Input, Textarea } from '@f4d/ui/components/field';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, type FieldPath, useForm } from 'react-hook-form';
import { ChipGroup } from '@/features/profile/chips';
import { useLevels, useStacks } from '@/features/profile/queries';
import { api } from '@/lib/api';
import { compact } from '@/lib/compact';
import { errorMessage, problemOf } from '@/lib/problem';

/** O formulário trabalha com texto (um item por linha) e reais; a API recebe listas e centavos. */
interface ScopeForm {
  type: ProjectType;
  objective: string;
  featuresText: string;
  screensText: string;
  criteriaText: string;
  requiredStacks: string[];
  levelSlug: string;
  priceMin: number;
  priceMax: number;
  deadlineDays: number;
  notesForFreelancers: string;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const toInput = (form: ScopeForm): ScopeInput => ({
  type: form.type,
  objective: form.objective,
  features: lines(form.featuresText),
  screens: lines(form.screensText),
  acceptanceCriteria: lines(form.criteriaText),
  requiredStacks: form.requiredStacks,
  levelSlug: form.levelSlug,
  priceRange: {
    minCents: Math.round(form.priceMin * 100),
    maxCents: Math.round(form.priceMax * 100),
  },
  deadlineDays: form.deadlineDays,
  ...(form.notesForFreelancers.trim() ? { notesForFreelancers: form.notesForFreelancers } : {}),
});

/** Caminho do erro no contrato (`priceRange.maxCents`) → campo do formulário. */
const FIELD_OF: Record<string, FieldPath<ScopeForm>> = {
  type: 'type',
  objective: 'objective',
  features: 'featuresText',
  screens: 'screensText',
  acceptanceCriteria: 'criteriaText',
  requiredStacks: 'requiredStacks',
  levelSlug: 'levelSlug',
  'priceRange.minCents': 'priceMin',
  'priceRange.maxCents': 'priceMax',
  deadlineDays: 'deadlineDays',
  notesForFreelancers: 'notesForFreelancers',
};

const fieldFor = (path: string): FieldPath<ScopeForm> | undefined => {
  const clean = path.replace(/^body\./, '');
  return FIELD_OF[clean] ?? FIELD_OF[clean.split('.')[0] ?? ''];
};

/** Ponto de partida: a versão atual do escopo ou, na primeira vez, a sugestão da IA. */
const initialValues = (project: AdminProjectDetail): ScopeForm => {
  const { scope, estimate } = project;
  if (scope) {
    return {
      type: scope.type,
      objective: scope.objective,
      featuresText: scope.features.join('\n'),
      screensText: scope.screens.join('\n'),
      criteriaText: scope.acceptanceCriteria.join('\n'),
      requiredStacks: scope.requiredStacks,
      levelSlug: scope.levelSlug,
      priceMin: scope.priceRange.minCents / 100,
      priceMax: scope.priceRange.maxCents / 100,
      deadlineDays: scope.deadlineDays,
      notesForFreelancers: scope.notesForFreelancers ?? '',
    };
  }
  return {
    type: estimate?.suggestedType ?? project.type,
    objective: estimate?.summary ?? '',
    featuresText: estimate?.features.join('\n') ?? '',
    screensText: '',
    criteriaText: '',
    requiredStacks: estimate?.suggestedStacks ?? [],
    levelSlug: estimate?.suggestedLevel ?? '',
    priceMin: (estimate?.priceRange.minCents ?? 0) / 100,
    priceMax: (estimate?.priceRange.maxCents ?? 0) / 100,
    deadlineDays: estimate?.durationDays.max ?? 30,
    notesForFreelancers: '',
  };
};

export function ScopeEditor({ project }: { project: AdminProjectDetail }) {
  const queryClient = useQueryClient();
  const levels = useLevels();
  const stacks = useStacks();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const form = useForm<ScopeForm>({ defaultValues: initialValues(project) });
  const { errors, isDirty } = form.formState;
  const currentVersion = project.scopeVersions[0]?.version ?? 0;

  const update = (detail: AdminProjectDetail) => {
    queryClient.setQueryData(['admin', 'projects', 'detail', project.id], detail);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'projects'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'metrics'] });
  };

  const run = async (action: () => Promise<AdminProjectDetail>, success: string) => {
    setFeedback(null);
    setPending(true);
    try {
      const detail = await action();
      update(detail);
      setFeedback({ tone: 'success', text: success });
      return detail;
    } catch (error) {
      const issues = problemOf(error)?.errors ?? [];
      for (const issue of issues) {
        const field = fieldFor(issue.path);
        if (field) form.setError(field, { type: 'server', message: issue.message });
      }
      setFeedback({ tone: 'error', text: errorMessage(error) });
      return null;
    } finally {
      setPending(false);
    }
  };

  const save = form.handleSubmit(async (values) => {
    const input = toInput(values);
    const parsed = scopeInputSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = fieldFor(issue.path.join('.'));
        if (field) form.setError(field, { type: 'validation', message: issue.message });
      }
      setFeedback({ tone: 'error', text: 'Confira os campos destacados.' });
      return;
    }
    const detail = await run(
      () =>
        unwrap(
          api.PUT('/v1/admin/projects/{projectId}/scope', {
            params: { path: { projectId: project.id } },
            body: compact(parsed.data),
          }),
        ),
      'Versão salva.',
    );
    if (detail) form.reset(values);
  });

  const approve = () => {
    if (!window.confirm(`Aprovar a versão ${currentVersion} do escopo? O cliente será avisado.`))
      return;
    void run(
      () =>
        unwrap(
          api.POST('/v1/admin/projects/{projectId}/approve', {
            params: { path: { projectId: project.id } },
            body: { version: currentVersion },
          }),
        ),
      'Escopo aprovado: o projeto está pronto para a fila.',
    );
  };

  const reject = () =>
    void run(
      () =>
        unwrap(
          api.POST('/v1/admin/projects/{projectId}/reject', {
            params: { path: { projectId: project.id } },
            body: { reason: rejectReason },
          }),
        ),
      'Projeto recusado. O cliente recebeu o motivo por e-mail.',
    );

  const fieldError = (name: keyof ScopeForm) => errors[name]?.message;

  return (
    <Card tone="white" className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 font-medium">Escopo</h2>
        <p className="text-body text-muted">
          {currentVersion === 0
            ? 'Preenchido com a sugestão da IA. Ajuste e salve a primeira versão.'
            : `Versão atual: ${currentVersion}. Cada "Salvar" cria uma versão nova.`}
        </p>
      </div>

      <form
        onSubmit={(event) => {
          // Erros marcados na tentativa anterior bloqueariam o envio: a validação refaz tudo.
          form.clearErrors();
          void save(event);
        }}
        className="flex flex-col gap-6"
        noValidate
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Field id="type" label="Tipo de projeto" error={errors.type?.message}>
            <select
              {...fieldA11y('type', errors.type?.message)}
              className="rounded-button border border-dark bg-bg px-5 py-4 text-body"
              {...form.register('type')}
            >
              {(Object.entries(PROJECT_TYPE_LABELS) as [ProjectType, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field id="levelSlug" label="Nível do freelancer" error={errors.levelSlug?.message}>
            <select
              {...fieldA11y('levelSlug', errors.levelSlug?.message)}
              className="rounded-button border border-dark bg-bg px-5 py-4 text-body"
              {...form.register('levelSlug')}
            >
              <option value="">Escolha…</option>
              {(levels.data ?? []).map((level) => (
                <option key={level.slug} value={level.slug}>
                  {level.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field id="objective" label="Objetivo" error={errors.objective?.message}>
          <Textarea
            {...fieldA11y('objective', errors.objective?.message)}
            rows={3}
            {...form.register('objective')}
          />
        </Field>

        <div className="grid gap-5 md:grid-cols-2">
          <Field
            id="featuresText"
            label="Funcionalidades"
            hint="Uma por linha."
            error={fieldError('featuresText')}
          >
            <Textarea
              {...fieldA11y('featuresText', fieldError('featuresText'), true)}
              rows={7}
              {...form.register('featuresText')}
            />
          </Field>
          <Field
            id="screensText"
            label="Telas / páginas (opcional)"
            hint="Uma por linha."
            error={fieldError('screensText')}
          >
            <Textarea
              {...fieldA11y('screensText', fieldError('screensText'), true)}
              rows={7}
              {...form.register('screensText')}
            />
          </Field>
        </div>

        <Field
          id="criteriaText"
          label="Critérios de aceite"
          hint="Uma por linha. É o que define 'entregue' — e o que é fora de escopo."
          error={fieldError('criteriaText')}
        >
          <Textarea
            {...fieldA11y('criteriaText', fieldError('criteriaText'), true)}
            rows={4}
            {...form.register('criteriaText')}
          />
        </Field>

        <div className="grid gap-5 md:grid-cols-3">
          <Field id="priceMin" label="Faixa: mínimo (R$)" error={errors.priceMin?.message}>
            <Input
              {...fieldA11y('priceMin', errors.priceMin?.message)}
              type="number"
              min={0}
              step={100}
              {...form.register('priceMin', { valueAsNumber: true })}
            />
          </Field>
          <Field id="priceMax" label="Faixa: máximo (R$)" error={errors.priceMax?.message}>
            <Input
              {...fieldA11y('priceMax', errors.priceMax?.message)}
              type="number"
              min={0}
              step={100}
              {...form.register('priceMax', { valueAsNumber: true })}
            />
          </Field>
          <Field
            id="deadlineDays"
            label="Prazo (dias corridos)"
            error={errors.deadlineDays?.message}
          >
            <Input
              {...fieldA11y('deadlineDays', errors.deadlineDays?.message)}
              type="number"
              min={1}
              {...form.register('deadlineDays', { valueAsNumber: true })}
            />
          </Field>
        </div>

        <Controller
          control={form.control}
          name="requiredStacks"
          render={({ field }) => (
            <ChipGroup
              legend="Stacks obrigatórias (opcional — só se o projeto exigir)"
              options={(stacks.data ?? []).map((stack) => ({
                value: stack.slug,
                label: stack.name,
              }))}
              value={field.value}
              onChange={field.onChange}
              max={8}
            />
          )}
        />

        <Field
          id="notesForFreelancers"
          label="Observações para os freelancers (opcional)"
          error={errors.notesForFreelancers?.message}
        >
          <Textarea
            {...fieldA11y('notesForFreelancers', errors.notesForFreelancers?.message)}
            rows={3}
            {...form.register('notesForFreelancers')}
          />
        </Field>

        {feedback ? <Alert tone={feedback.tone}>{feedback.text}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="outline" disabled={pending}>
            Salvar versão
          </Button>
          <Button
            type="button"
            disabled={pending || currentVersion === 0 || isDirty}
            onClick={approve}
          >
            Aprovar escopo
          </Button>
        </div>
        {isDirty && currentVersion > 0 ? (
          <p className="text-sm text-muted">Salve as alterações antes de aprovar.</p>
        ) : null}
      </form>

      <details className="rounded-[20px] border border-dark p-4">
        <summary className="cursor-pointer font-medium">Recusar projeto</summary>
        <div className="mt-4 flex flex-col gap-3">
          <Field
            id="rejectReason"
            label="Motivo (enviado ao cliente)"
            hint="Ex.: pedido fora de desenvolvimento de software."
          >
            <Textarea
              id="rejectReason"
              rows={3}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            className="h-12 self-start px-6"
            disabled={pending || rejectReason.trim().length < 10}
            onClick={reject}
          >
            Recusar
          </Button>
        </div>
      </details>
    </Card>
  );
}
