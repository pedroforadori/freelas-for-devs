import type { ContractStatus } from '@f4d/contracts';
import type { ContractsDeps } from './ports.js';

export interface ContractParticipants {
  id: string;
  projectId: string;
  clientId: string;
  freelancerId: string;
  status: ContractStatus;
}

/** API pública do módulo de contratos (ex.: o chat precisa saber quem participa). */
export class ContractsFacade {
  constructor(private readonly deps: ContractsDeps) {}

  async find(contractId: string): Promise<ContractParticipants | null> {
    const contract = await this.deps.contracts.find(contractId);
    if (!contract) return null;
    return {
      id: contract.id,
      projectId: contract.projectId,
      clientId: contract.clientId,
      freelancerId: contract.freelancerId,
      status: contract.status,
    };
  }
}
