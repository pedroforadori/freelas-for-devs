import type { Metadata } from 'next';
import { ContractList } from '@/features/contracts/contract-list';

export const metadata: Metadata = { title: 'Contratos' };

export default function Page() {
  return <ContractList />;
}
