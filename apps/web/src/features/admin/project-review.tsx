'use client';

import { unwrap } from '@f4d/api-client';
import {
  type AdminProjectDetail,
  DESIRED_DEADLINE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useLevels } from '@/features/profile/queries';
import { ScopeView } from '@/features/projects/scope-view';
import { dateTime, formatDuration, formatPriceRange } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';
import { DistributionSection } from './distribution-section';
import { ScopeEditor } from './scope-editor';

const COMPLEXITY = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta' } as const;

/**
 * Leitura do projeto para o especialista: pedido do cliente, respostas e a estimativa completa
 * da IA (nível, stacks, riscos e alertas) ao lado do editor de escopo versionado (F4).
 */
export function ProjectReview({ projectId }: { projectId: string }) {
  const levels = useLevels();
  const query = useQuery({
    queryKey: ['admin', 'projects', 'detail', projectId],
    queryFn: () =>
      unwrap(api.GET('/v1/admin/projects/{projectId}', { params: { path: { projectId } } })),
  });
  if (query.isPending) return <p role="status">Carregando…</p>;
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  const project = query.data;

  return (
    <>
      <Link href="/admin/projetos" className="text-body underline">
        ← Voltar para projetos
      </Link>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="dark">{PROJECT_STATUS_LABELS[project.status]}</Badge>
          <span className="text-sm text-muted">
            {PROJECT_TYPE_LABELS[project.type]} · {project.client.displayName} (
            {project.client.email}) · {dateTime.format(new Date(project.createdAt))}
          </span>
        </div>
        <h1 className="text-h3 font-medium">{project.title}</h1>
      </div>

      <Card tone="white" className="flex flex-col gap-4">
        <h2 className="text-h4 font-medium">Pedido do cliente</h2>
        <p className="text-body whitespace-pre-line">{project.description}</p>
        {project.desiredDeadline ? (
          <Fact label="Prazo desejado">{DESIRED_DEADLINE_LABELS[project.desiredDeadline]}</Fact>
        ) : null}
        {project.references.length > 0 ? (
          <Fact label="Referências">
            <ul>
              {project.references.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          </Fact>
        ) : null}
        {project.attachments.length > 0 ? (
          <Fact label="Anexos">{project.attachments.map((file) => file.fileName).join(', ')}</Fact>
        ) : null}
        {project.clarification?.answers ? <Answers project={project} /> : null}
      </Card>

      {project.estimate ? (
        <Card tone="accent" className="flex flex-col gap-4">
          <h2 className="text-h4 font-medium">Estimativa da IA (sugestão)</h2>
          <p className="text-h4">
            {formatPriceRange(project.estimate.priceRange)} ·{' '}
            {formatDuration(project.estimate.durationDays)}
          </p>
          <p className="text-body">{project.estimate.summary}</p>
          <div className="flex flex-wrap gap-2">
            <Badge tone="dark">
              Nível sugerido:{' '}
              {levels.data?.find((level) => level.slug === project.estimate?.suggestedLevel)
                ?.name ?? project.estimate.suggestedLevel}
            </Badge>
            <Badge>Complexidade {COMPLEXITY[project.estimate.complexity]}</Badge>
            <Badge>Tipo sugerido: {PROJECT_TYPE_LABELS[project.estimate.suggestedType]}</Badge>
            {project.estimate.suggestedStacks.map((slug) => (
              <Badge key={slug}>{slug}</Badge>
            ))}
          </div>
          <List title="Funcionalidades" items={project.estimate.features} />
          <List title="Premissas" items={project.estimate.assumptions} />
          <List title="Riscos" items={project.estimate.risks} />
          {project.estimate.reviewNotes.length > 0 ? (
            <Alert tone="error" title="Alertas para o especialista">
              <ul className="list-disc pl-6">
                {project.estimate.reviewNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </Card>
      ) : project.estimateUnavailable ? (
        <Alert tone="error" title="Sem estimativa automática">
          A IA falhou em todas as tentativas. Estime manualmente ao fechar o escopo.
        </Alert>
      ) : null}

      <ScopeSection project={project} />
      <DistributionSection projectId={project.id} />
      <AiRuns runs={project.aiRuns} />
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-body">
      <p className="font-medium">{label}</p>
      {children}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{title}</p>
      <ul className="list-disc pl-6 text-body">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Answers({ project }: { project: AdminProjectDetail }) {
  const { questions, answers } = project.clarification ?? { questions: [], answers: [] };
  return (
    <Fact label="Respostas às perguntas da IA">
      <ul className="list-disc pl-6">
        {questions.map((question) => {
          const answer = answers?.find((a) => a.questionId === question.id);
          const text =
            answer?.other ?? question.options.find((o) => o.id === answer?.optionId)?.label ?? '—';
          return (
            <li key={question.id}>
              {question.question} <strong>{text}</strong>
            </li>
          );
        })}
      </ul>
    </Fact>
  );
}

function AiRuns({ runs }: { runs: AdminProjectDetail['aiRuns'] }) {
  if (runs.length === 0) return null;
  const tokens = runs.reduce((sum, run) => sum + run.inputTokens + run.outputTokens, 0);
  return (
    <Card tone="surface" className="flex flex-col gap-3">
      <h2 className="text-h4 font-medium">Chamadas à IA</h2>
      <p className="text-sm text-muted">{tokens.toLocaleString('pt-BR')} tokens no total.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-dark">
              <th className="py-2 pr-4">Quando</th>
              <th className="py-2 pr-4">Rodada</th>
              <th className="py-2 pr-4">Resultado</th>
              <th className="py-2 pr-4">Modelo / prompt</th>
              <th className="py-2 pr-4">Tokens (entrada/saída)</th>
              <th className="py-2">Duração</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.createdAt + run.outcome} className="border-b border-dark/20">
                <td className="py-2 pr-4">{dateTime.format(new Date(run.createdAt))}</td>
                <td className="py-2 pr-4">{run.round}</td>
                <td className="py-2 pr-4">{run.outcome}</td>
                <td className="py-2 pr-4">
                  {run.model} / {run.promptVersion}
                </td>
                <td className="py-2 pr-4">
                  {run.inputTokens} / {run.outputTokens}
                </td>
                <td className="py-2">{(run.durationMs / 1000).toFixed(1)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Editor enquanto em escopo; escopo aprovado (com reabertura) depois; histórico de versões. */
function ScopeSection({ project }: { project: AdminProjectDetail }) {
  const queryClient = useQueryClient();
  const levels = useLevels();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reopen = async () => {
    if (!window.confirm('Voltar o escopo para edição? O projeto sai da fila até nova aprovação.'))
      return;
    setError(null);
    setPending(true);
    try {
      const detail = await unwrap(
        api.POST('/v1/admin/projects/{projectId}/reopen', {
          params: { path: { projectId: project.id } },
        }),
      );
      queryClient.setQueryData(['admin', 'projects', 'detail', project.id], detail);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'projects'] });
    } catch (reopenError) {
      setError(errorMessage(reopenError));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {project.status === 'SCOPING' ? <ScopeEditor project={project} /> : null}
      {project.status === 'READY_FOR_QUEUE' && project.scope ? (
        <Card tone="accent" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-h4 font-medium">
              Escopo aprovado (versão {project.scopeVersions[0]?.version})
            </h2>
            <Badge tone="dark">
              Nível{' '}
              {levels.data?.find((level) => level.slug === project.scope?.levelSlug)?.name ??
                project.scope.levelSlug}
            </Badge>
          </div>
          <ScopeView scope={project.scope} />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button
            variant="outline"
            className="h-12 self-start px-6"
            disabled={pending}
            onClick={() => void reopen()}
          >
            Reabrir para edição
          </Button>
        </Card>
      ) : null}
      {project.status === 'REJECTED' ? (
        <Alert tone="error" title="Projeto recusado">
          {project.rejectionReason}
        </Alert>
      ) : null}
      {project.scopeVersions.length > 0 ? (
        <details className="rounded-[20px] border border-dark bg-surface p-4">
          <summary className="cursor-pointer font-medium">
            Histórico do escopo ({project.scopeVersions.length}{' '}
            {project.scopeVersions.length === 1 ? 'versão' : 'versões'})
          </summary>
          <ol className="mt-4 flex flex-col gap-4">
            {project.scopeVersions.map((version) => (
              <li key={version.version} className="flex flex-col gap-3 rounded-[14px] bg-bg p-4">
                <p className="text-sm text-muted">
                  Versão {version.version} · {version.createdBy} ·{' '}
                  {dateTime.format(new Date(version.createdAt))}
                </p>
                <ScopeView scope={version.scope} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}
