'use client';

import { unwrap } from '@f4d/api-client';
import {
  createProjectRequestSchema,
  DESIRED_DEADLINE_LABELS,
  FILE_RULES,
  PROJECT_LIMITS,
  PROJECT_TYPE_LABELS,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button, buttonClasses } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useState } from 'react';
import { api } from '@/lib/api';
import { compact } from '@/lib/compact';
import { errorMessage } from '@/lib/problem';
import { UploadRejectedError, uploadFile } from '@/lib/upload';
import { useDraftHydrated, useProjectDraft } from '@/stores/project-draft';
import { formatFileSize } from './format';
import { useSetProject } from './queries';

const ACCEPT = FILE_RULES.PROJECT_ATTACHMENT.contentTypes.join(',');

/** Última etapa (já com conta): revisar o rascunho, anexar arquivos e publicar. */
export function ReviewAndPublish() {
  const hydrated = useDraftHydrated();
  const router = useRouter();
  const setProject = useSetProject();
  const draft = useProjectDraft((state) => state.draft);
  const update = useProjectDraft((state) => state.update);
  const reset = useProjectDraft((state) => state.reset);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hydrated) return <p role="status">Carregando seu rascunho…</p>;

  const request = createProjectRequestSchema.safeParse({
    title: draft.title,
    type: draft.type,
    description: draft.description,
    references: draft.references,
    ...(draft.desiredDeadline ? { desiredDeadline: draft.desiredDeadline } : {}),
    attachmentIds: draft.attachments.map((attachment) => attachment.id),
  });

  if (!request.success) {
    return (
      <Card tone="surface" className="flex flex-col gap-4">
        <h1 className="text-h3 font-medium">Seu rascunho está incompleto</h1>
        <p className="text-body">Volte e descreva o projeto para continuar.</p>
        <Link href="/novo-projeto" className={buttonClasses('primary', 'self-start')}>
          Descrever projeto
        </Link>
      </Card>
    );
  }

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    const room = PROJECT_LIMITS.attachmentsMax - draft.attachments.length;
    if (files.length > room) {
      setError(`Você pode anexar até ${PROJECT_LIMITS.attachmentsMax} arquivos.`);
      return;
    }
    setError(null);
    setUploading(true);
    const added = [...draft.attachments];
    try {
      for (const file of files) {
        const uploaded = await uploadFile(file, 'PROJECT_ATTACHMENT');
        added.push({ id: uploaded.id, fileName: uploaded.fileName, size: uploaded.size });
        update({ attachments: [...added] });
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof UploadRejectedError
          ? uploadError.message
          : errorMessage(uploadError),
      );
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    setError(null);
    setPublishing(true);
    try {
      const project = await unwrap(api.POST('/v1/projects', { body: compact(request.data) }));
      setProject(project);
      reset();
      router.replace(`/projetos/${project.id}`);
    } catch (publishError) {
      setError(errorMessage(publishError));
      setPublishing(false);
    }
  };

  const { data } = request;
  return (
    <>
      <SectionHeading title="Revisar e publicar">
        Confira os dados. Depois de publicar, a estimativa fica pronta em segundos.
      </SectionHeading>

      <Card tone="white" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted">{PROJECT_TYPE_LABELS[data.type]}</p>
          <h1 className="text-h3 font-medium">{data.title}</h1>
        </div>
        <p className="text-body whitespace-pre-line">{data.description}</p>
        {data.references.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="font-medium">Referências</p>
            <ul className="text-body">
              {data.references.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data.desiredDeadline ? (
          <p className="text-body">
            <span className="font-medium">Prazo desejado:</span>{' '}
            {DESIRED_DEADLINE_LABELS[data.desiredDeadline]}
          </p>
        ) : null}
        <Link href="/novo-projeto" className="self-start text-body underline">
          Editar descrição
        </Link>
      </Card>

      <Card tone="surface" className="flex flex-col gap-4">
        <h2 className="text-h4 font-medium">Anexos (opcional)</h2>
        <p className="text-body">
          Rascunhos, prints, documentos ou um briefing em PDF ajudam o especialista e os devs. Até{' '}
          {PROJECT_LIMITS.attachmentsMax} arquivos de até 20 MB (imagens, PDF ou ZIP).
        </p>
        {draft.attachments.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {draft.attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex items-center justify-between gap-3 rounded-[14px] border border-dark bg-bg px-4 py-2"
              >
                <span className="truncate">
                  {attachment.fileName}{' '}
                  <span className="text-sm text-muted">({formatFileSize(attachment.size)})</span>
                </span>
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() =>
                    update({
                      attachments: draft.attachments.filter((a) => a.id !== attachment.id),
                    })
                  }
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {draft.attachments.length < PROJECT_LIMITS.attachmentsMax ? (
          <label className={buttonClasses('outline', 'h-12 cursor-pointer self-start px-6')}>
            {uploading ? 'Enviando…' : 'Adicionar arquivos'}
            <input
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              disabled={uploading}
              onChange={(event) => void onFiles(event)}
            />
          </label>
        ) : null}
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        className="self-start"
        disabled={publishing || uploading}
        onClick={() => void publish()}
      >
        {publishing ? 'Publicando…' : 'Publicar projeto'}
      </Button>
    </>
  );
}
