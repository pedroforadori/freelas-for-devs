import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

let t: TestApp;
let admin: BrowserSession;
let counter = 0;

const signUp = async (role: 'CLIENT' | 'FREELANCER') => {
  const browser = await new BrowserSession(t.app).init();
  const email = `perfil${(counter += 1)}@exemplo.com`;
  const res = await browser.request('POST', '/v1/auth/register', {
    body: {
      email,
      password: 'uma senha bem longa',
      displayName: `Pessoa ${counter}`,
      role,
      acceptTerms: true,
    },
  });
  return { browser, email, userId: res.json<{ user: { id: string } }>().user.id };
};

const completeProfile = {
  headline: 'Dev full-stack JavaScript',
  bio: 'Construo sites e sistemas web com React, Next.js e Node.js, com foco em performance e acessibilidade. '.repeat(
    2,
  ),
  stacks: ['react', 'nextjs', 'nodejs'],
  projectTypes: ['SITE', 'SYSTEM'],
  links: { github: 'https://github.com/pessoa' },
  available: true,
};

/** Freelancer com perfil completo e enviado para análise. */
const submittedFreelancer = async () => {
  const freelancer = await signUp('FREELANCER');
  await freelancer.browser.request('PUT', '/v1/me/freelancer-profile', { body: completeProfile });
  await freelancer.browser.request('POST', '/v1/me/freelancer-profile/portfolio', {
    body: {
      title: 'Loja de cafés',
      description: 'E-commerce headless com Next.js e Stripe.',
      url: 'https://cafes.example.com',
      stacks: ['nextjs'],
    },
  });
  const submitted = await freelancer.browser.request('POST', '/v1/me/freelancer-profile/submit');
  expect(submitted.json()).toMatchObject({ status: 'PENDING_REVIEW' });
  return freelancer;
};

beforeAll(async () => {
  t = await createTestApp();
  admin = await createAdminSession(t);
});

beforeEach(async () => {
  await t.redis.flushall();
});

afterAll(async () => {
  await t?.close();
});

describe('catalog', () => {
  it('lists stacks and levels from the seed', async () => {
    const stacks = await t.app.inject({ method: 'GET', url: '/v1/catalog/stacks' });
    expect(stacks.json<{ items: unknown[] }>().items.length).toBeGreaterThan(30);
    const levels = await t.app.inject({ method: 'GET', url: '/v1/catalog/levels' });
    expect(levels.json<{ items: { slug: string }[] }>().items[0]).toMatchObject({
      slug: 'iniciante',
      rank: 1,
    });
  });
});

describe('freelancer profile', () => {
  it('starts as a draft and explains what is missing before submission', async () => {
    const { browser } = await signUp('FREELANCER');
    const profile = await browser.request('GET', '/v1/me/freelancer-profile');
    expect(profile.json()).toMatchObject({ status: 'DRAFT', level: null });
    expect(profile.json<{ missingForSubmission: string[] }>().missingForSubmission).toHaveLength(5);

    const submit = await browser.request('POST', '/v1/me/freelancer-profile/submit');
    expect(submit.statusCode).toBe(409);
    expect(submit.json<{ detail: string }>().detail).toContain('Perfil incompleto');
  });

  it('validates stacks against the catalog and links against their hosts', async () => {
    const { browser } = await signUp('FREELANCER');
    const unknownStack = await browser.request('PUT', '/v1/me/freelancer-profile', {
      body: { ...completeProfile, stacks: ['react', 'cobol-quantico'] },
    });
    expect(unknownStack.statusCode).toBe(400);
    expect(unknownStack.json<{ detail: string }>().detail).toContain('cobol-quantico');

    const wrongHost = await browser.request('PUT', '/v1/me/freelancer-profile', {
      body: { ...completeProfile, links: { github: 'https://gitlab.com/pessoa' } },
    });
    expect(wrongHost.json()).toMatchObject({ errors: [{ path: 'body.links.github' }] });

    const insecure = await browser.request('PUT', '/v1/me/freelancer-profile', {
      body: { ...completeProfile, links: { website: 'http://site.com' } },
    });
    expect(insecure.statusCode).toBe(400);
  });

  it('is not writable by clients', async () => {
    const { browser } = await signUp('CLIENT');
    expect((await browser.request('GET', '/v1/me/freelancer-profile')).statusCode).toBe(403);
    const client = await browser.request('PUT', '/v1/me/client-profile', {
      body: { companyName: 'Padaria Pão Bom' },
    });
    expect(client.json()).toMatchObject({ companyName: 'Padaria Pão Bom' });
  });
});

describe('admin review', () => {
  it('approves from the review queue, assigns the initial level and notifies the freelancer', async () => {
    const freelancer = await submittedFreelancer();

    const queue = await admin.request(
      'GET',
      '/v1/admin/freelancers?status=PENDING_REVIEW&limit=50',
    );
    const entry = queue
      .json<{ items: { userId: string; stacks: string[] }[] }>()
      .items.find((i) => i.userId === freelancer.userId);
    expect(entry?.stacks).toEqual(['nextjs', 'nodejs', 'react']);

    const approved = await admin.request(
      'POST',
      `/v1/admin/freelancers/${freelancer.userId}/approve`,
      { body: {} },
    );
    expect(approved.json()).toMatchObject({
      status: 'APPROVED',
      level: { slug: 'iniciante' },
      email: freelancer.email,
      levelHistory: [{ from: null, to: 'iniciante', reason: 'Aprovação do perfil' }],
    });
    expect(
      t.mail.jobs.some((j) => j.data.to === freelancer.email && j.data.tag === 'profiles.approved'),
    ).toBe(true);

    const client = await signUp('CLIENT');
    const publicProfile = await client.browser.request(
      'GET',
      `/v1/freelancers/${freelancer.userId}`,
    );
    expect(publicProfile.statusCode).toBe(200);
    expect(publicProfile.json()).toMatchObject({
      headline: completeProfile.headline,
      level: { slug: 'iniciante' },
    });
    expect(JSON.stringify(publicProfile.json())).not.toContain(freelancer.email);
  });

  it('requests changes with a reason and accepts the resubmission', async () => {
    const freelancer = await submittedFreelancer();
    await admin.request('POST', `/v1/admin/freelancers/${freelancer.userId}/request-changes`, {
      body: { reason: 'Descreva melhor sua experiência com Node.js.' },
    });

    const mine = await freelancer.browser.request('GET', '/v1/me/freelancer-profile');
    expect(mine.json()).toMatchObject({
      status: 'CHANGES_REQUESTED',
      reviewNote: 'Descreva melhor sua experiência com Node.js.',
    });
    const resubmitted = await freelancer.browser.request(
      'POST',
      '/v1/me/freelancer-profile/submit',
    );
    expect(resubmitted.json()).toMatchObject({ status: 'PENDING_REVIEW', reviewNote: null });
  });

  it('reclassifies levels with a mandatory reason and keeps the history', async () => {
    const freelancer = await submittedFreelancer();
    await admin.request('POST', `/v1/admin/freelancers/${freelancer.userId}/approve`, { body: {} });

    const noReason = await admin.request(
      'POST',
      `/v1/admin/freelancers/${freelancer.userId}/level`,
      {
        body: { levelSlug: 'avancado', reason: '' },
      },
    );
    expect(noReason.statusCode).toBe(400);

    const res = await admin.request('POST', `/v1/admin/freelancers/${freelancer.userId}/level`, {
      body: { levelSlug: 'avancado', reason: 'Portfólio com projetos publicados e GitHub ativo.' },
    });
    expect(res.json()).toMatchObject({
      level: { slug: 'avancado' },
      levelHistory: [{ from: 'iniciante', to: 'avancado' }, { to: 'iniciante' }],
    });
  });

  it('hides non-approved profiles from the public and admin routes from non-admins', async () => {
    const freelancer = await submittedFreelancer();
    const client = await signUp('CLIENT');
    expect(
      (await client.browser.request('GET', `/v1/freelancers/${freelancer.userId}`)).statusCode,
    ).toBe(404);
    expect((await freelancer.browser.request('GET', '/v1/admin/freelancers')).statusCode).toBe(403);
  });
});
