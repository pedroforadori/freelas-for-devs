import { SectionHeading } from '@f4d/ui/components/section-heading';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ProjectDraftForm } from '@/features/projects/draft-form';

export const metadata: Metadata = { title: 'Publicar projeto' };

const STEPS = [
  'Descreva sua ideia (sem cadastro).',
  'A IA estima preço e prazo — às vezes com 2 ou 3 perguntas rápidas.',
  'Um especialista fecha o escopo com você antes de qualquer dev ser convidado.',
];

/** Página pública: o rascunho só pede conta na hora de publicar. */
export default function Page() {
  return (
    <>
      <header className="border-b border-dark/10">
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-5 md:px-0">
          <Link href="/" className="text-h4 font-medium">
            Freelas 4 Devs
          </Link>
          <Link href="/entrar?redirectTo=%2Fnovo-projeto" className="text-body underline">
            Já tenho conta
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-content flex-col gap-10 px-4 py-10 md:px-0">
        <SectionHeading title="Publicar projeto">
          Não sabe quanto custa? Sem problema: descreva e receba uma estimativa na hora.
        </SectionHeading>
        <ol className="grid gap-3 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3 rounded-[20px] border border-dark bg-surface p-4">
              <span className="font-medium">0{index + 1}</span>
              <span className="text-body">{step}</span>
            </li>
          ))}
        </ol>
        <Suspense>
          <ProjectDraftForm />
        </Suspense>
      </main>
    </>
  );
}
