'use client';

import {
  createProjectRequestSchema,
  DESIRED_DEADLINE_LABELS,
  type DesiredDeadline,
  desiredDeadlineSchema,
  PROJECT_LIMITS,
  PROJECT_TYPE_LABELS,
  type ProjectType,
  projectTypeSchema,
} from '@f4d/contracts';
import { cn } from '@f4d/ui/cn';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Field, fieldA11y, Input, Textarea } from '@f4d/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { hasRole, useSession } from '@/features/auth/session';
import { compact } from '@/lib/compact';
import { type ProjectDraft, useDraftHydrated, useProjectDraft } from '@/stores/project-draft';

export const REVIEW_PATH = '/novo-projeto/revisar';

const TYPE_HINTS: Record<ProjectType, string> = {
  SITE: 'Institucional, landing page, portfólio',
  ECOMMERCE: 'Venda online, catálogo, pagamentos',
  APP: 'Aplicativo para celular (iOS / Android)',
  SYSTEM: 'Agendamento, gestão, área do cliente',
  OTHER: 'Automação, integração, ajuste em algo existente',
};

const splitLinks = (text: string) =>
  text
    .split(/\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

/** Mesmas regras do contrato da API; os links chegam como texto (um por linha). */
const draftFormSchema = createProjectRequestSchema
  .pick({ title: true, type: true, description: true, desiredDeadline: true })
  .extend({
    // Rádio sem nada marcado chega como null; o contrato espera o campo ausente.
    desiredDeadline: desiredDeadlineSchema.nullish().transform((value) => value ?? undefined),
    referencesText: z
      .string()
      .transform(splitLinks)
      .pipe(createProjectRequestSchema.shape.references.unwrap()),
  });

type DraftInput = z.input<typeof draftFormSchema>;
type DraftOutput = z.output<typeof draftFormSchema>;

const toDraft = (values: Partial<DraftInput>): Partial<ProjectDraft> => ({
  type: values.type ?? null,
  title: values.title ?? '',
  description: values.description ?? '',
  references: splitLinks(values.referencesText ?? ''),
  desiredDeadline: values.desiredDeadline ?? null,
});

/** Rascunho do projeto: público, salvo no navegador a cada alteração. */
export function ProjectDraftForm() {
  const hydrated = useDraftHydrated();
  if (!hydrated) {
    return (
      <p role="status" className="text-body text-muted">
        Carregando seu rascunho…
      </p>
    );
  }
  return <DraftFormInner />;
}

function DraftFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, isLoading } = useSession();
  const draft = useProjectDraft((state) => state.draft);
  const update = useProjectDraft((state) => state.update);
  const [roleError, setRoleError] = useState(false);
  const typeFromLink = projectTypeSchema.safeParse(params.get('tipo')).data;

  const form = useForm<DraftInput, unknown, DraftOutput>({
    resolver: zodResolver(draftFormSchema),
    defaultValues: compact({
      type: draft.type ?? typeFromLink,
      title: draft.title,
      description: draft.description,
      referencesText: draft.references.join('\n'),
      desiredDeadline: draft.desiredDeadline ?? undefined,
    }),
  });
  const { errors, isSubmitting } = form.formState;
  const description = useWatch({ control: form.control, name: 'description' }) ?? '';
  const selectedType = useWatch({ control: form.control, name: 'type' });

  // Salva a cada alteração: o cliente pode sair para criar a conta e voltar sem perder nada.
  const { subscribe } = form;
  useEffect(
    () =>
      subscribe({
        formState: { values: true },
        callback: ({ values }) => update(toDraft(values)),
      }),
    [subscribe, update],
  );

  const onSubmit = form.handleSubmit((values) => {
    update({ ...toDraft(form.getValues()), references: values.referencesText });
    if (!me) {
      router.push(`/cadastro?redirectTo=${encodeURIComponent(REVIEW_PATH)}`);
      return;
    }
    if (!hasRole(me, 'CLIENT')) {
      setRoleError(true);
      return;
    }
    router.push(REVIEW_PATH);
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8" noValidate>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-body font-medium">O que você quer construir?</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map((type) => (
            <label
              key={type}
              className={cn(
                'cursor-pointer rounded-[20px] border border-dark p-4 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dark',
                selectedType === type ? 'bg-accent shadow-brutal' : 'bg-bg hover:bg-surface',
              )}
            >
              <input type="radio" value={type} className="sr-only" {...form.register('type')} />
              <span className="block font-medium">{PROJECT_TYPE_LABELS[type]}</span>
              <span className="block text-sm">{TYPE_HINTS[type]}</span>
            </label>
          ))}
        </div>
        {errors.type ? (
          <p role="alert" className="text-sm text-red-700">
            Escolha o tipo de projeto.
          </p>
        ) : null}
      </fieldset>

      <Field
        id="title"
        label="Dê um nome ao projeto"
        hint="Ex.: Loja virtual de roupas femininas"
        error={errors.title?.message}
      >
        <Input
          {...fieldA11y('title', errors.title?.message, true)}
          maxLength={PROJECT_LIMITS.titleMax}
          {...form.register('title')}
        />
      </Field>

      <Field
        id="description"
        label="Descreva sua ideia"
        hint={`Conte o que é, para quem e o que precisa fazer. Não precisa saber termos técnicos. ${description.length}/${PROJECT_LIMITS.descriptionMax}`}
        error={errors.description?.message}
      >
        <Textarea
          {...fieldA11y('description', errors.description?.message, true)}
          rows={8}
          maxLength={PROJECT_LIMITS.descriptionMax}
          placeholder="Ex.: Tenho uma loja de roupas e quero vender pela internet. Preciso de catálogo por categorias, pagamento com Pix e cartão e cálculo de frete…"
          {...form.register('description')}
        />
      </Field>

      <Field
        id="referencesText"
        label="Sites ou apps de referência (opcional)"
        hint={`Um link por linha, até ${PROJECT_LIMITS.referencesMax}.`}
        error={
          (errors.referencesText as { message?: string } | undefined)?.message ??
          (errors.referencesText
            ? 'Confira os links: use endereços começando com https://'
            : undefined)
        }
      >
        <Textarea
          {...fieldA11y('referencesText', errors.referencesText ? 'erro' : undefined, true)}
          rows={3}
          className="min-h-0"
          placeholder="https://www.exemplo.com.br"
          {...form.register('referencesText')}
        />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-body font-medium">Para quando você precisa? (opcional)</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(DESIRED_DEADLINE_LABELS) as [DesiredDeadline, string][]).map(
            ([value, label]) => (
              <label
                key={value}
                className="cursor-pointer rounded-pill border border-dark px-3 py-1.5 text-sm has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dark"
              >
                <input
                  type="radio"
                  value={value}
                  className="sr-only"
                  {...form.register('desiredDeadline')}
                />
                {label}
              </label>
            ),
          )}
        </div>
      </fieldset>

      {roleError ? (
        <Alert tone="error" title="Esta conta é de freelancer">
          Para publicar um projeto, entre com uma conta de cliente.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" disabled={isSubmitting || isLoading}>
          Continuar
        </Button>
        <p className="text-sm text-muted">
          {me
            ? 'Na próxima etapa você revisa, anexa arquivos e publica.'
            : 'Seu rascunho fica salvo neste navegador enquanto você cria a conta (é grátis).'}
        </p>
      </div>
    </form>
  );
}
