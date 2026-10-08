'use client';

import { unwrap } from '@f4d/api-client';
import {
  type ClientEstimate,
  DESIRED_DEADLINE_LABELS,
  type Project,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';
import { ClarificationForm } from './clarification-form';
import { dateTime, formatDuration, formatFileSize, formatPriceRange } from './format';
import { useProject, useSetProject } from './queries';

export function ProjectDetail({ projectId }: { projectId: string }) {
  const query = useProject(projectId);
  if (query.isPending) return <p role="status">Carregando…</p>;
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  const project = query.data;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="dark">{PROJECT_STATUS_LABELS[project.status]}</Badge>
          <span className="text-sm text-muted">
            {PROJECT_TYPE_LABELS[project.type]} · publicado em{' '}
            {dateTime.format(new Date(project.createdAt))}
          </span>
        </div>
        <h1 className="text-h3 font-medium md:text-h2">{project.title}</h1>
      </div>

      <StatusPanel project={project} />
      <ProjectInfo project={project} />
      {project.status !== 'CANCELLED' ? <CancelProject project={project} /> : null}
    </>
  );
}

function StatusPanel({ project }: { project: Project }) {
  switch (project.status) {
    case 'ESTIMATING':
      return (
        <Card tone="surface" className="flex flex-col gap-3" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="size-3 animate-pulse rounded-full bg-dark" aria-hidden="true" />
            <h2 className="text-h4 font-medium">Analisando seu projeto…</h2>
          </div>
          <p className="text-body">
            A estimativa costuma ficar pronta em menos de 15 segundos. Pode sair desta página: você
            também recebe um e-mail.
          </p>
        </Card>
      );
    case 'AWAITING_CLARIFICATION':
      return <ClarificationForm project={project} />;
    case 'SCOPING':
      return project.estimate ? (
        <EstimateCard estimate={project.estimate} />
      ) : (
        <Card tone="surface" className="flex flex-col gap-3">
          <h2 className="text-h4 font-medium">Seu projeto está com um especialista</h2>
          <p className="text-body">
            Não conseguimos gerar a estimativa automática agora. Um especialista da plataforma vai
            estimar preço e prazo ao fechar o escopo com você.
          </p>
        </Card>
      );
    case 'CANCELLED':
      return <Alert title="Projeto cancelado">Este projeto não recebe mais propostas.</Alert>;
  }
}

function EstimateCard({ estimate }: { estimate: ClientEstimate }) {
  return (
    <Card tone="accent" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium tracking-wide uppercase">Estimativa preliminar</p>
        <p className="text-h3 font-medium md:text-h2">{formatPriceRange(estimate.priceRange)}</p>
        <p className="text-lead">Prazo estimado: {formatDuration(estimate.durationDays)}</p>
      </div>
      <p className="text-body">{estimate.summary}</p>
      {estimate.features.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">O que está incluído</h2>
          <ul className="list-disc pl-6 text-body">
            {estimate.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {estimate.assumptions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Premissas</h2>
          <ul className="list-disc pl-6 text-body">
            {estimate.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-[20px] border border-dark bg-bg p-4 text-body">
        <p className="font-medium">Próximo passo</p>
        <p>
          Um especialista revisa o escopo com você e define a faixa final. Só depois disso o projeto
          vai para os devs, em rodadas — você não paga nada até escolher uma proposta.
        </p>
      </div>
    </Card>
  );
}

function ProjectInfo({ project }: { project: Project }) {
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (fileId: string) => {
    setDownloadError(null);
    try {
      const { url } = await unwrap(
        api.GET('/v1/files/{fileId}/download', { params: { path: { fileId } } }),
      );
      window.location.assign(url);
    } catch (error) {
      setDownloadError(errorMessage(error));
    }
  };

  return (
    <Card tone="white" className="flex flex-col gap-6">
      <h2 className="text-h4 font-medium">Descrição</h2>
      <p className="text-body whitespace-pre-line">{project.description}</p>
      {project.desiredDeadline ? (
        <p className="text-body">
          <span className="font-medium">Prazo desejado:</span>{' '}
          {DESIRED_DEADLINE_LABELS[project.desiredDeadline]}
        </p>
      ) : null}
      {project.references.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Referências</p>
          <ul className="text-body">
            {project.references.map((url) => (
              <li key={url} className="break-all">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {project.attachments.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Anexos</p>
          <ul className="flex flex-col gap-2">
            {project.attachments.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {file.fileName}{' '}
                  <span className="text-sm text-muted">({formatFileSize(file.size)})</span>
                </span>
                {file.status === 'READY' ? (
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => void download(file.id)}
                  >
                    Baixar
                  </button>
                ) : (
                  <Badge>{file.status === 'REJECTED' ? 'Recusado' : 'Em verificação'}</Badge>
                )}
              </li>
            ))}
          </ul>
          {downloadError ? <Alert tone="error">{downloadError}</Alert> : null}
        </div>
      ) : null}
    </Card>
  );
}

function CancelProject({ project }: { project: Project }) {
  const setProject = useSetProject();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const cancel = async () => {
    if (!window.confirm('Cancelar este projeto? Essa ação não pode ser desfeita.')) return;
    setError(null);
    setPending(true);
    try {
      setProject(
        await unwrap(
          api.POST('/v1/projects/{projectId}/cancel', {
            params: { path: { projectId: project.id } },
            body: {},
          }),
        ),
      );
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="outline"
        className="h-12 self-start px-6"
        disabled={pending}
        onClick={() => void cancel()}
      >
        Cancelar projeto
      </Button>
    </div>
  );
}
