import { CreateContractForSelection } from '../../src/modules/contracts/application/use-cases.js';
import { OpenRound, SyncQueueEntry } from '../../src/modules/distribution/application/use-cases.js';
import { GenerateEstimate } from '../../src/modules/projects/application/use-cases.js';
import { ScanUploadedFile } from '../../src/modules/files/application/use-cases.js';
import { BrowserSession, type TestApp } from './test-app.js';

/**
 * Cenários do marketplace para testes e2e: chamam a API como os usuários fariam e, onde o worker
 * entraria (eventos do outbox), executam o mesmo caso de uso que ele executa.
 */
export interface Person {
  browser: BrowserSession;
  userId: string;
  email: string;
}

export const DESCRIPTION =
  'Site institucional para a padaria do bairro, com cardápio, fotos dos produtos, horário de ' +
  'funcionamento, mapa e um formulário de contato para encomendas de bolos.';
const MESSAGE =
  'Faço o site em Next.js com painel simples para o cardápio. Já entreguei três sites parecidos ' +
  'e posso mostrar os links. Entrego em etapas para você acompanhar.';

let counter = 0;

export const marketplace = (t: TestApp, admin: () => BrowserSession) => {
  const register = async (role: 'CLIENT' | 'FREELANCER', name: string): Promise<Person> => {
    // Todos os cadastros saem do mesmo "IP" no teste: zera o limite por IP.
    await t.redis.flushall();
    const browser = await new BrowserSession(t.app).init();
    const email = `pessoa${(counter += 1)}@exemplo.com`;
    await browser.request('POST', '/v1/auth/register', {
      body: { email, password: 'uma senha bem longa', displayName: name, role, acceptTerms: true },
    });
    const { id } = (await browser.request('GET', '/v1/me')).json<{ id: string }>();
    return { browser, userId: id, email };
  };

  const freelancer = async (name: string): Promise<Person> => {
    const person = await register('FREELANCER', name);
    await person.browser.request('PUT', '/v1/me/freelancer-profile', {
      body: {
        headline: `Dev ${name} para sites`,
        bio: 'Desenvolvo sites rápidos e acessíveis, com foco em pequenos negócios. '.repeat(3),
        stacks: ['react'],
        projectTypes: ['SITE'],
        links: { github: 'https://github.com/dev' },
        available: true,
      },
    });
    await person.browser.request('POST', '/v1/me/freelancer-profile/submit');
    await admin().request('POST', `/v1/admin/freelancers/${person.userId}/approve`, {
      body: { levelSlug: 'iniciante' },
    });
    await t.app.get(SyncQueueEntry).execute(person.userId, 'iniciante');
    t.clock.advance(1000);
    return person;
  };

  /** Upload completo (pedido, PUT no storage, confirmação e verificação). */
  const upload = async (
    person: Person,
    purpose: 'PROJECT_ATTACHMENT' | 'DELIVERY_FILE',
    fileName = 'arquivo.pdf',
  ): Promise<string> => {
    const content = new TextEncoder().encode(`%PDF-1.7\n${'conteúdo '.repeat(20)}`);
    const created = await person.browser.request('POST', '/v1/files/uploads', {
      body: { purpose, fileName, contentType: 'application/pdf', size: content.length },
    });
    const { file, upload: target } = created.json<{
      file: { id: string };
      upload: { url: string; headers: Record<string, string> };
    }>();
    t.storage.simulateUpload(target.url, content, target.headers['content-type']!);
    await person.browser.request('POST', `/v1/files/${file.id}/complete`);
    await t.app.get(ScanUploadedFile).execute(file.id);
    return file.id;
  };

  /** Cliente com projeto publicado e escopo aprovado; Ana convidada (rodada aberta). */
  const projectInDistribution = async (options: { attachments?: boolean } = {}) => {
    const ana = await freelancer('Ana');
    const client = await register('CLIENT', 'Cliente');
    const attachmentIds = options.attachments ? [await upload(client, 'PROJECT_ATTACHMENT')] : [];
    const created = await client.browser.request('POST', '/v1/projects', {
      body: { title: 'Site da padaria', type: 'SITE', description: DESCRIPTION, attachmentIds },
    });
    const projectId = created.json<{ id: string }>().id;
    await t.app.get(GenerateEstimate).execute(projectId, 1);
    await admin().request('PUT', `/v1/admin/projects/${projectId}/scope`, {
      body: {
        type: 'SITE',
        objective: 'Site institucional da padaria com cardápio e contato.',
        features: ['Cardápio'],
        acceptanceCriteria: ['Site publicado'],
        levelSlug: 'iniciante',
        priceRange: { minCents: 200_000, maxCents: 400_000 },
        deadlineDays: 30,
      },
    });
    await admin().request('POST', `/v1/admin/projects/${projectId}/approve`, {
      body: { version: 1 },
    });
    await t.app.get(OpenRound).execute(projectId);
    const invitationId = (await ana.browser.request('GET', '/v1/me/invitations?view=open')).json<{
      items: { id: string }[];
    }>().items[0]!.id;
    return { ana, client, projectId, invitationId, attachmentIds };
  };

  /** Proposta de Ana (R$ 3.000) escolhida e paga: contrato ativo na 1ª entrega. */
  const activeContract = async () => {
    const scenario = await projectInDistribution();
    const { ana, client, projectId, invitationId } = scenario;
    await ana.browser.request('PUT', `/v1/invitations/${invitationId}/proposal`, {
      body: { amountCents: 300_000, deadlineDays: 25, message: MESSAGE },
    });
    await client.browser.request('POST', `/v1/projects/${projectId}/selection`, {
      body: { invitationId },
    });
    const contract = await t.app.get(CreateContractForSelection).execute({
      projectId,
      invitationId,
      clientId: client.userId,
      freelancerId: ana.userId,
      amountCents: 300_000,
      deadlineDays: 25,
    });
    const { url } = (
      await client.browser.request('POST', `/v1/contracts/${contract.id}/checkout`)
    ).json<{ url: string }>();
    await client.browser.request('POST', '/v1/dev/payments/simulate', {
      body: { checkoutId: new URL(url).searchParams.get('checkout'), outcome: 'succeeded' },
    });
    return { ...scenario, contractId: contract.id };
  };

  return { register, freelancer, upload, projectInDistribution, activeContract };
};
