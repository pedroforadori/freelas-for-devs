import { type ClientScope, PROJECT_TYPE_LABELS } from '@f4d/contracts';
import { Badge } from '@f4d/ui/components/badge';
import { formatPriceRange } from './format';

/** Escopo fechado: o que será construído, por quanto, em quanto tempo e como é aceito. */
export function ScopeView({ scope }: { scope: ClientScope }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Fact label="Faixa de preço">{formatPriceRange(scope.priceRange)}</Fact>
        <Fact label="Prazo">{scope.deadlineDays} dias</Fact>
        <Fact label="Tipo">{PROJECT_TYPE_LABELS[scope.type]}</Fact>
      </div>
      <p className="text-body">{scope.objective}</p>
      <List title="Funcionalidades" items={scope.features} />
      <List title="Telas / páginas" items={scope.screens} />
      <List title="Critérios de aceite" items={scope.acceptanceCriteria} />
      {scope.requiredStacks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Tecnologias:</span>
          {scope.requiredStacks.map((slug) => (
            <Badge key={slug}>{slug}</Badge>
          ))}
        </div>
      ) : null}
      {scope.notesForFreelancers ? (
        <div className="text-body">
          <p className="font-medium">Observações</p>
          <p className="whitespace-pre-line">{scope.notesForFreelancers}</p>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-dark bg-bg p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-h4 font-medium">{children}</p>
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
