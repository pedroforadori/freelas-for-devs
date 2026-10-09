'use client';

import { unwrap } from '@f4d/api-client';
import { type Setting, SETTINGS, type SettingInput } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Input } from '@f4d/ui/components/field';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dateTime } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const settingsKey = ['admin', 'settings'] as const;

/** Valor bruto da API (centavos, bps) ↔ valor mostrado no campo (reais, %). */
const toField = (input: SettingInput, value: unknown): string => {
  if (input.kind === 'money') return String(Number(value) / 100);
  if (input.kind === 'percent') return String(Number(value) / 100);
  return String(value);
};

const fromField = (input: SettingInput, text: string): unknown => {
  if (input.kind === 'enum') return text;
  const number = Number(text.replace(',', '.'));
  if (input.kind === 'money' || input.kind === 'percent') return Math.round(number * 100);
  return number;
};

const display = (input: SettingInput, value: unknown): string => {
  switch (input.kind) {
    case 'money':
      return `R$ ${(Number(value) / 100).toLocaleString('pt-BR')}`;
    case 'percent':
      return `${(Number(value) / 100).toLocaleString('pt-BR')}%`;
    case 'enum':
      return input.options.find((option) => option.value === value)?.label ?? String(value);
    case 'integer':
      return `${String(value)} ${input.unit}`;
  }
};

/** Parâmetros de negócio (comissão, prazos, fila). Mudanças valem para o que for criado depois. */
export function SettingsPage() {
  const query = useQuery({
    queryKey: settingsKey,
    queryFn: () => unwrap(api.GET('/v1/admin/settings')).then((result) => result.items),
  });

  return (
    <>
      <SectionHeading title="Configurações">
        Regras de negócio da plataforma. Prazos e percentuais são copiados para cada rodada e
        contrato no momento da criação: mudar aqui não afeta o que já está em andamento.
      </SectionHeading>
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? <p role="status">Carregando…</p> : null}
      <ul className="flex flex-col gap-4">
        {(query.data ?? []).map((setting) => (
          <li key={setting.key}>
            <SettingRow setting={setting} />
          </li>
        ))}
      </ul>
    </>
  );
}

function SettingRow({ setting }: { setting: Setting }) {
  const queryClient = useQueryClient();
  const { input } = SETTINGS[setting.key];
  const [value, setValue] = useState(toField(input, setting.value));
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const changed = value !== toField(input, setting.value);
  const id = `setting-${setting.key}`;

  const save = async () => {
    setFeedback(null);
    setPending(true);
    try {
      const updated = await unwrap(
        api.PUT('/v1/admin/settings/{key}', {
          params: { path: { key: setting.key } },
          body: { value: fromField(input, value), expectedVersion: setting.version },
        }),
      );
      queryClient.setQueryData<Setting[]>(settingsKey, (items) =>
        items?.map((item) => (item.key === updated.key ? updated : item)),
      );
      setFeedback({ tone: 'success', text: 'Salvo.' });
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card tone="white" className="flex flex-col gap-4 p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-h4 font-medium">
          {setting.label}
        </label>
        <Badge>a partir da {setting.usedFrom}</Badge>
      </div>
      <p className="text-body">{setting.description}</p>
      <div className="flex flex-wrap items-center gap-3">
        {input.kind === 'enum' ? (
          <select
            id={id}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="rounded-button border border-dark bg-bg px-5 py-4 text-body"
          >
            {input.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-2">
            {input.kind === 'money' ? <span>R$</span> : null}
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              step={input.kind === 'integer' ? 1 : 0.01}
              className="w-40"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <span>
              {input.kind === 'percent' ? '%' : input.kind === 'integer' ? input.unit : ''}
            </span>
          </div>
        )}
        <Button
          variant="outline"
          className="h-12 px-6"
          disabled={!changed || pending}
          onClick={() => void save()}
        >
          Salvar
        </Button>
      </div>
      <p className="text-sm text-muted">
        Padrão: {display(input, setting.defaultValue)}
        {setting.updatedAt
          ? ` · alterado por ${setting.updatedBy ?? '—'} em ${dateTime.format(new Date(setting.updatedAt))}`
          : ' · nunca alterado'}
      </p>
      {feedback ? <Alert tone={feedback.tone}>{feedback.text}</Alert> : null}
    </Card>
  );
}
