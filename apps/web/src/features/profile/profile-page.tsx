'use client';

import { unwrap } from '@f4d/api-client';
import type { FreelancerProfile } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Input } from '@f4d/ui/components/field';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { hasRole, useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';
import { Portfolio } from './portfolio';
import { ProfileForm } from './profile-form';
import { useFreelancerProfile, useSetFreelancerProfile, useStacks } from './queries';
import { MyReputation } from '@/features/reputation/reputation-card';

const STATUS_LABEL: Record<FreelancerProfile['status'], string> = {
  DRAFT: 'Rascunho',
  PENDING_REVIEW: 'Em análise',
  CHANGES_REQUESTED: 'Ajustes pedidos',
  APPROVED: 'Aprovado',
};

function SubmissionPanel({ profile }: { profile: FreelancerProfile }) {
  const setProfile = useSetFreelancerProfile();
  const submit = useMutation({
    mutationFn: () => unwrap(api.POST('/v1/me/freelancer-profile/submit')),
    onSuccess: setProfile,
  });
  const canSubmit = profile.status === 'DRAFT' || profile.status === 'CHANGES_REQUESTED';

  return (
    <Card
      tone={profile.status === 'APPROVED' ? 'accent' : 'surface'}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="dark">{STATUS_LABEL[profile.status]}</Badge>
        {profile.level ? <Badge>Nível {profile.level.name}</Badge> : null}
      </div>
      {profile.status === 'CHANGES_REQUESTED' && profile.reviewNote ? (
        <Alert tone="info" title="O que ajustar">
          {profile.reviewNote}
        </Alert>
      ) : null}
      {profile.status === 'PENDING_REVIEW' ? (
        <p className="text-body">Recebemos seu perfil. A análise costuma levar até 2 dias úteis.</p>
      ) : null}
      {canSubmit ? (
        profile.missingForSubmission.length > 0 ? (
          <div>
            <p className="text-body font-medium">Para enviar à análise, falta:</p>
            <ul className="mt-2 list-disc pl-6 text-body">
              {profile.missingForSubmission.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body">Tudo pronto! Salve suas alterações e envie para análise.</p>
            <Button
              className="self-start"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? 'Enviando…' : 'Enviar para análise'}
            </Button>
          </div>
        )
      ) : null}
      {submit.isError ? <Alert tone="error">{errorMessage(submit.error)}</Alert> : null}
    </Card>
  );
}

function FreelancerProfileSection() {
  const profile = useFreelancerProfile();
  const stacks = useStacks();
  if (profile.isError || stacks.isError)
    return <Alert tone="error">{errorMessage(profile.error ?? stacks.error)}</Alert>;
  if (!profile.data || !stacks.data) return <p role="status">Carregando perfil…</p>;
  return (
    <>
      <SectionHeading title="Seu perfil">
        É assim que clientes e o time da plataforma conhecem você. Sem testes técnicos: seu
        histórico e portfólio falam por você.
      </SectionHeading>
      <SubmissionPanel profile={profile.data} />
      <MyReputation />
      <ProfileForm key={profile.data.updatedAt} profile={profile.data} stacks={stacks.data} />
      <Portfolio profile={profile.data} stacks={stacks.data} />
    </>
  );
}

function ClientProfileSection() {
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ['profile', 'client'],
    queryFn: () => unwrap(api.GET('/v1/me/client-profile')),
  });
  const [companyName, setCompanyName] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string) =>
      unwrap(api.PUT('/v1/me/client-profile', { body: { companyName: value || null } })),
    onSuccess: (data) => queryClient.setQueryData(['profile', 'client'], data),
  });
  if (!profile.data) return null;
  const value = companyName ?? profile.data.companyName ?? '';

  return (
    <section className="flex flex-col gap-5">
      <SectionHeading title="Dados de cliente" />
      <form
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(value);
        }}
      >
        <Field id="companyName" label="Empresa (opcional)">
          <Input
            {...fieldA11y('companyName')}
            value={value}
            maxLength={120}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </Field>
        {save.isSuccess ? <Alert tone="success">Salvo.</Alert> : null}
        {save.isError ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
        <Button type="submit" className="self-start" disabled={save.isPending}>
          Salvar
        </Button>
      </form>
    </section>
  );
}

export function ProfilePage() {
  const { me } = useSession();
  return (
    <>
      {hasRole(me, 'FREELANCER') ? <FreelancerProfileSection /> : null}
      {hasRole(me, 'CLIENT') ? <ClientProfileSection /> : null}
    </>
  );
}
