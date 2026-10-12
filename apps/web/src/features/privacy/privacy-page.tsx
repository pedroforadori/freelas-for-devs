'use client';

import { unwrap } from '@f4d/api-client';
import { DELETE_CONFIRMATION } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Input } from '@f4d/ui/components/field';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { meQueryKey } from '@/features/auth/session';
import { api } from '@/lib/api';
import { legalUrls } from '@/lib/env';
import { errorMessage } from '@/lib/problem';

/** Direitos do titular (LGPD): baixar os dados e excluir a conta. */
export function PrivacyPage() {
  return (
    <>
      <SectionHeading title="Privacidade">
        Seus dados são seus. Baixe tudo o que guardamos sobre você ou exclua sua conta. Detalhes na{' '}
        <a href={legalUrls.privacy} className="underline">
          política de privacidade
        </a>
        .
      </SectionHeading>
      <ExportCard />
      <DeleteCard />
    </>
  );
}

function ExportCard() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setError(null);
    setPending(true);
    try {
      const data = await unwrap(api.GET('/v1/me/data-export'));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `freelas4devs-meus-dados-${data.generatedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(errorMessage(exportError));
    } finally {
      setPending(false);
    }
  };
  return (
    <Card tone="white" className="flex flex-col gap-4 border border-dark">
      <h2 className="text-h4 font-medium">Baixar meus dados</h2>
      <p className="text-body">
        Um arquivo JSON com sua conta, perfis, projetos, propostas, contratos, avaliações, mensagens
        que você enviou, arquivos e o histórico de acessos.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Button variant="outline" disabled={pending} onClick={() => void download()}>
          {pending ? 'Preparando…' : 'Baixar meus dados'}
        </Button>
      </div>
    </Card>
  );
}

function DeleteCard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const check = useQuery({
    queryKey: ['privacy', 'deletion-check'],
    queryFn: () => unwrap(api.GET('/v1/me/deletion-check')),
  });
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    setPending(true);
    try {
      await unwrap(
        api.POST('/v1/me/delete', {
          body: {
            confirmation: confirmation as typeof DELETE_CONFIRMATION,
            ...(password ? { password } : {}),
          },
        }),
      );
      queryClient.setQueryData(meQueryKey, null);
      queryClient.clear();
      router.replace('/entrar?conta=excluida');
    } catch (deleteError) {
      setError(errorMessage(deleteError));
      setPending(false);
    }
  };

  const data = check.data;
  return (
    <Card tone="white" className="flex flex-col gap-4 border border-red-700">
      <h2 className="text-h4 font-medium">Excluir minha conta</h2>
      <p className="text-body">
        Apagamos seu perfil, portfólio, vínculos de login e a lista de espera, e anonimizamos a
        conta. Por obrigação legal, contratos e pagamentos continuam registrados, sem identificar
        você; mensagens que você enviou continuam visíveis para quem as recebeu, como “Conta
        excluída”. Não dá para desfazer.
      </p>
      {check.isError ? <Alert tone="error">{errorMessage(check.error)}</Alert> : null}
      {data && !data.canDelete ? (
        <Alert title="Ainda não é possível excluir">
          <ul className="list-disc pl-6">
            {data.blockers.map((blocker) => (
              <li key={blocker.kind}>{blocker.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {data?.canDelete && !open ? (
        <div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Quero excluir minha conta
          </Button>
        </div>
      ) : null}
      {data?.canDelete && open ? (
        <div className="flex flex-col gap-4">
          <Field id="confirmation" label={`Digite ${DELETE_CONFIRMATION} para confirmar`}>
            <Input
              {...fieldA11y('confirmation')}
              value={confirmation}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          {data.hasPassword ? (
            <Field id="delete-password" label="Sua senha">
              <Input
                {...fieldA11y('delete-password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                pending || confirmation !== DELETE_CONFIRMATION || (data.hasPassword && !password)
              }
              onClick={() => void remove()}
              className="bg-red-700 hover:bg-red-800"
            >
              {pending ? 'Excluindo…' : 'Excluir definitivamente'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
