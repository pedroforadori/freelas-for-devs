import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/require-auth';
import { InvitationDetail } from '@/features/invitations/invitation-detail';

export const metadata: Metadata = { title: 'Convite' };

export default async function Page({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  return (
    <RequireAuth roles={['FREELANCER']}>
      <InvitationDetail invitationId={invitationId} />
    </RequireAuth>
  );
}
