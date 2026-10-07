import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScanUploadedFile } from '../../src/modules/files/application/use-cases.js';
import { auditLog } from '../../src/db/schema/audit.js';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

let t: TestApp;
let counter = 0;

const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(120).fill(1),
]);
const SVG_AS_PNG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const EICAR_ZIP = new Uint8Array([
  0x50,
  0x4b,
  0x03,
  0x04,
  ...new TextEncoder().encode(
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  ),
]);

const user = async (role: 'CLIENT' | 'FREELANCER' = 'FREELANCER') => {
  const browser = await new BrowserSession(t.app).init();
  await browser.request('POST', '/v1/auth/register', {
    body: {
      email: `arquivo${(counter += 1)}@exemplo.com`,
      password: 'uma senha bem longa',
      displayName: 'Pessoa',
      role,
      acceptTerms: true,
    },
  });
  return browser;
};

/** Pede a URL, "envia" o conteúdo ao storage e confirma — como o web fará. */
const upload = async (
  browser: BrowserSession,
  content: Uint8Array,
  declared: { name: string; type: string; purpose?: string },
) => {
  const created = await browser.request('POST', '/v1/files/uploads', {
    body: {
      purpose: declared.purpose ?? 'PORTFOLIO_IMAGE',
      fileName: declared.name,
      contentType: declared.type,
      size: content.length,
    },
  });
  expect(created.statusCode).toBe(201);
  const { file, upload: target } = created.json<{
    file: { id: string };
    upload: { url: string; headers: Record<string, string> };
  }>();
  t.storage.simulateUpload(target.url, content, target.headers['content-type']!);
  const completed = await browser.request('POST', `/v1/files/${file.id}/complete`);
  expect(completed.statusCode).toBe(202);
  return file.id;
};

const runScan = (fileId: string) => t.app.get(ScanUploadedFile).execute(fileId);

beforeAll(async () => {
  t = await createTestApp();
});

beforeEach(async () => {
  await t.redis.flushall();
});

afterAll(async () => {
  await t?.close();
});

describe('secure upload pipeline', () => {
  it('quarantines, verifies and then releases a valid image', async () => {
    const browser = await user();
    const fileId = await upload(browser, PNG, {
      name: '../../logo "final".png',
      type: 'image/png',
    });

    expect((await browser.request('GET', `/v1/files/${fileId}`)).json()).toMatchObject({
      status: 'SCANNING',
      fileName: 'logo final.png',
    });
    expect(t.fileScans.jobs.some((j) => j.data.fileId === fileId)).toBe(true);
    // Ainda em quarentena: download indisponível.
    expect((await browser.request('GET', `/v1/files/${fileId}/download`)).statusCode).toBe(409);

    await runScan(fileId);
    expect((await browser.request('GET', `/v1/files/${fileId}`)).json()).toMatchObject({
      status: 'READY',
    });
    expect(t.storage.objects.quarantine.size).toBe(0);
    const download = await browser.request('GET', `/v1/files/${fileId}/download`);
    expect(download.json<{ url: string }>().url).toContain(
      'response-content-disposition=attachment',
    );
  });

  it('rejects disallowed types and oversized files before issuing the upload URL', async () => {
    const browser = await user();
    const svg = await browser.request('POST', '/v1/files/uploads', {
      body: {
        purpose: 'PORTFOLIO_IMAGE',
        fileName: 'x.svg',
        contentType: 'image/svg+xml',
        size: 100,
      },
    });
    expect(svg.json()).toMatchObject({ errors: [{ path: 'body.contentType' }] });
    const huge = await browser.request('POST', '/v1/files/uploads', {
      body: {
        purpose: 'PORTFOLIO_IMAGE',
        fileName: 'x.png',
        contentType: 'image/png',
        size: 50 * 1024 * 1024,
      },
    });
    expect(huge.json()).toMatchObject({ errors: [{ path: 'body.size' }] });
  });

  it('rejects content that does not match the declared type (SVG disguised as PNG)', async () => {
    const browser = await user();
    const created = await browser.request('POST', '/v1/files/uploads', {
      body: {
        purpose: 'PORTFOLIO_IMAGE',
        fileName: 'foto.png',
        contentType: 'image/png',
        size: SVG_AS_PNG.length,
      },
    });
    const { file } = created.json<{ file: { id: string } }>();
    t.storage.forceObject(`quarantine/${file.id}`, SVG_AS_PNG);
    await browser.request('POST', `/v1/files/${file.id}/complete`);
    await runScan(file.id);

    expect((await browser.request('GET', `/v1/files/${file.id}`)).json()).toMatchObject({
      status: 'REJECTED',
      rejectionReason: expect.stringContaining('não corresponde'),
    });
    expect(t.storage.objects.quarantine.has(`quarantine/${file.id}`)).toBe(false);
  });

  it('blocks malware and records it in the audit log', async () => {
    const browser = await user('CLIENT');
    const fileId = await upload(browser, EICAR_ZIP, {
      name: 'projeto.zip',
      type: 'application/zip',
      purpose: 'PROJECT_ATTACHMENT',
    });
    await runScan(fileId);

    expect((await browser.request('GET', `/v1/files/${fileId}`)).json()).toMatchObject({
      status: 'REJECTED',
    });
    expect(t.storage.objects.files.size).toBe(1); // só a imagem válida do primeiro teste
    const audits = await t.database.db.select().from(auditLog);
    expect(audits.some((a) => a.action === 'files.malware_detected' && a.targetId === fileId)).toBe(
      true,
    );
  });

  it('keeps files private to their owner (admins can read, and it is audited)', async () => {
    const owner = await user();
    const fileId = await upload(owner, PNG, { name: 'privado.png', type: 'image/png' });
    await runScan(fileId);

    const stranger = await user();
    expect((await stranger.request('GET', `/v1/files/${fileId}`)).statusCode).toBe(404);
    expect((await stranger.request('POST', `/v1/files/${fileId}/complete`)).statusCode).toBe(404);

    const admin = await createAdminSession(t);
    expect((await admin.request('GET', `/v1/files/${fileId}/download`)).statusCode).toBe(200);
    const audits = await t.database.db.select().from(auditLog);
    expect(
      audits.some((a) => a.action === 'files.downloaded_by_other' && a.targetId === fileId),
    ).toBe(true);
  });

  it('refuses to confirm an upload that never reached the storage', async () => {
    const browser = await user();
    const created = await browser.request('POST', '/v1/files/uploads', {
      body: { purpose: 'PORTFOLIO_IMAGE', fileName: 'a.png', contentType: 'image/png', size: 10 },
    });
    const { file } = created.json<{ file: { id: string } }>();
    const res = await browser.request('POST', `/v1/files/${file.id}/complete`);
    expect(res.statusCode).toBe(400);
  });
});
