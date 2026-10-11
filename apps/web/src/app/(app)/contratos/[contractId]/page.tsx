import type { Metadata } from 'next';
import { ContractWorkspace } from '@/features/contracts/contract-workspace';

export const metadata: Metadata = { title: 'Contrato' };

export default async function Page({ params }: { params: Promise<{ contractId: string }> }) {
  const { contractId } = await params;
  return <ContractWorkspace contractId={contractId} />;
}
