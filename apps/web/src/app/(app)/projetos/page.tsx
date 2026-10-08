import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/require-auth';
import { ProjectList } from '@/features/projects/project-list';

export const metadata: Metadata = { title: 'Projetos' };

export default function Page() {
  return (
    <RequireAuth roles={['CLIENT']}>
      <ProjectList />
    </RequireAuth>
  );
}
