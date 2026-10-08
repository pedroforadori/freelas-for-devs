'use client';

import { unwrap } from '@f4d/api-client';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button, buttonClasses } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { hasRole, useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const PROFILE_STATUS: Record<string, { label: string; text: string }> = {
  DRAFT: {
    label: 'Rascunho',
    text: 'Complete seu perfil e envie para análise para entrar na fila de projetos.',
  },
  PENDING_REVIEW: {
    label: 'Em análise',
    text: 'Estamos analisando seu perfil. Você recebe um e-mail com o resultado.',
  },
  CHANGES_REQUESTED: {
    label: 'Ajustes pedidos',
    text: 'Veja o que precisa ajustar e envie de novo.',
  },
  APPROVED: {
    label: 'Aprovado',
    text: 'Você está na fila de distribuição e receberá convites compatíveis.',
  },
};

function EmailVerificationBanner() {
  const resend = useMutation({ mutationFn: () => unwrap(api.POST('/v1/auth/email/resend')) });
  return (
    <Alert tone="info" title="Confirme seu e-mail">
      <p>Enviamos um link de confirmação para o seu e-mail.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          className="h-11 px-5"
          disabled={resend.isPending || resend.isSuccess}
          onClick={() => resend.mutate()}
        >
          {resend.isSuccess ? 'Link reenviado' : 'Reenviar link'}
        </Button>
        {resend.isError ? (
          <span className="text-sm text-red-700">{errorMessage(resend.error)}</span>
        ) : null}
      </div>
    </Alert>
  );
}

function FreelancerStatus() {
  const profile = useQuery({
    queryKey: ['profile', 'freelancer'],
    queryFn: () => unwrap(api.GET('/v1/me/freelancer-profile')),
  });
  if (!profile.data) return null;
  const status = PROFILE_STATUS[profile.data.status];
  return (
    <Card
      tone={profile.data.status === 'APPROVED' ? 'accent' : 'surface'}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h4 font-medium">Seu perfil de freelancer</h2>
        <Badge tone="dark">{status?.label}</Badge>
        {profile.data.level ? <Badge>Nível {profile.data.level.name}</Badge> : null}
      </div>
      <p className="text-body">{status?.text}</p>
      <Link href="/perfil" className={buttonClasses('primary', 'self-start')}>
        {profile.data.status === 'APPROVED' ? 'Ver perfil' : 'Completar perfil'}
      </Link>
    </Card>
  );
}

export function Dashboard() {
  const { me } = useSession();
  if (!me) return null;
  return (
    <>
      <SectionHeading title={`Olá, ${me.displayName.split(' ')[0] ?? ''}!`}>
        {hasRole(me, 'FREELANCER')
          ? 'Acompanhe seu perfil e os convites de projetos.'
          : 'Acompanhe seus projetos e conversas.'}
      </SectionHeading>
      {!me.emailVerified ? <EmailVerificationBanner /> : null}
      {hasRole(me, 'ADMIN') && me.sessionAal < 2 ? (
        <Alert tone="error" title="Ative a verificação em duas etapas">
          Ela é obrigatória para usar o painel administrativo.{' '}
          <Link href="/conta/seguranca" className="underline">
            Configurar agora
          </Link>
        </Alert>
      ) : null}
      {hasRole(me, 'FREELANCER') ? <FreelancerStatus /> : null}
      {hasRole(me, 'CLIENT') ? (
        <Card tone="surface" className="flex flex-col gap-4">
          <h2 className="text-h4 font-medium">Publique seu projeto</h2>
          <p className="text-body">
            Descreva sua ideia e receba uma estimativa de preço e prazo na hora — sem precisar saber
            quanto custa.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/novo-projeto" className={buttonClasses('primary')}>
              Publicar projeto
            </Link>
            <Link href="/projetos" className={buttonClasses('outline')}>
              Meus projetos
            </Link>
          </div>
        </Card>
      ) : null}
    </>
  );
}
