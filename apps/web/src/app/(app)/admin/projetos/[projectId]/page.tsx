import type { Metadata } from 'next';
import { ProjectReview } from '@/features/admin/project-review';

export const metadata: Metadata = { title: 'Admin · Projeto' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectReview projectId={projectId} />;
}
