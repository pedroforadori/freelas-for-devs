import type { Metadata } from 'next';
import { FreelancerReview } from '@/features/admin/freelancer-review';

export const metadata: Metadata = { title: 'Admin · Análise de perfil' };

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <FreelancerReview userId={userId} />;
}
