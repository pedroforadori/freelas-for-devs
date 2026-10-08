'use client';

import { unwrap } from '@f4d/api-client';
import { type ClarificationAnswer, PROJECT_LIMITS, type Project } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Input } from '@f4d/ui/components/field';
import { useState } from 'react';
import { api } from '@/lib/api';
import { compact } from '@/lib/compact';
import { errorMessage } from '@/lib/problem';
import { useSetProject } from './queries';

const OTHER = '__other__';

interface Choice {
  option: string;
  other: string;
}

/** Perguntas de múltipla escolha da IA; uma resposta por pergunta (opção ou "Outro"). */
export function ClarificationForm({ project }: { project: Project }) {
  const setProject = useSetProject();
  const questions = project.clarification?.questions ?? [];
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const choose = (questionId: string, patch: Partial<Choice>) =>
    setChoices((current) => ({
      ...current,
      [questionId]: { option: '', other: '', ...current[questionId], ...patch },
    }));

  const answers: (ClarificationAnswer | null)[] = questions.map((question) => {
    const choice = choices[question.id];
    if (!choice?.option) return null;
    if (choice.option !== OTHER) return { questionId: question.id, optionId: choice.option };
    const other = choice.other.trim();
    return other ? { questionId: question.id, other } : null;
  });
  const complete = answers.every((answer) => answer !== null);

  const submit = async () => {
    if (!complete) {
      setError('Responda todas as perguntas.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      setProject(
        await unwrap(
          api.POST('/v1/projects/{projectId}/clarifications', {
            params: { path: { projectId: project.id } },
            body: { answers: answers.map((answer) => compact(answer)) },
          }),
        ),
      );
    } catch (submitError) {
      setError(errorMessage(submitError));
      setSubmitting(false);
    }
  };

  return (
    <Card tone="accent" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-h4 font-medium">Faltam só algumas respostas</h2>
        <p className="text-body">
          Para estimar com mais precisão, responda às perguntas abaixo. Depois disso a estimativa
          fica pronta em segundos.
        </p>
      </div>
      {questions.map((question, index) => {
        const choice = choices[question.id];
        return (
          <fieldset key={question.id} className="flex flex-col gap-3">
            <legend className="mb-1 font-medium">
              {index + 1}. {question.question}
            </legend>
            <div className="flex flex-col gap-2">
              {[
                ...question.options.map((option) => ({ value: option.id, label: option.label })),
                ...(question.allowOther ? [{ value: OTHER, label: 'Outro' }] : []),
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-3 rounded-[14px] border border-dark bg-bg px-4 py-3 has-[:checked]:shadow-brutal has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dark"
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={option.value}
                    checked={choice?.option === option.value}
                    onChange={() => choose(question.id, { option: option.value })}
                    className="size-4 accent-dark"
                  />
                  {option.label}
                </label>
              ))}
              {choice?.option === OTHER ? (
                <Input
                  aria-label={`Sua resposta: ${question.question}`}
                  maxLength={PROJECT_LIMITS.otherAnswerMax}
                  value={choice.other}
                  onChange={(event) => choose(question.id, { other: event.target.value })}
                  placeholder="Escreva sua resposta"
                />
              ) : null}
            </div>
          </fieldset>
        );
      })}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button className="self-start" disabled={submitting} onClick={() => void submit()}>
        {submitting ? 'Enviando…' : 'Enviar respostas'}
      </Button>
    </Card>
  );
}
