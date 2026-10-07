import { Card } from '@f4d/ui/components/card';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { ApiStatus } from '@/features/system/api-status';

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-12 px-4 py-16 md:px-0">
      <SectionHeading title="Freelas 4 Devs">
        Plataforma em construção. As próximas fases trazem cadastro, publicação de projetos e a fila
        de distribuição.
      </SectionHeading>
      <Card tone="surface">
        <ApiStatus />
      </Card>
    </main>
  );
}
