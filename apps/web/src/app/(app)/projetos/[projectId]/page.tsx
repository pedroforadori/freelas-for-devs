import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/require-auth';
import { ProjectDetail } from '@/features/projects/project-detail';

export const metadata: Metadata = { title: 'Projeto' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <RequireAuth roles={['CLIENT']}>
      <ProjectDetail projectId={projectId} />
    </RequireAuth>
  );
}
