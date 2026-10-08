import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProjectQueue } from '@/features/admin/project-queue';

export const metadata: Metadata = { title: 'Admin · Projetos' };

export default function Page() {
  return (
    <Suspense>
      <ProjectQueue />
    </Suspense>
  );
}
