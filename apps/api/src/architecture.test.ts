import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Garante as fronteiras da arquitetura em camadas (ADR e docs/architecture.md §2), além do ESLint:
 * o domínio e os casos de uso precisam ser testáveis sem banco, HTTP ou frameworks.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));
const FRAMEWORK =
  /^(@nestjs\/|drizzle-orm|bullmq|pg$|ioredis|stripe|fastify|nestjs-pino|@sentry\/)/;
const OUTER_LAYER = /\/(infrastructure|interface)\/|\/shared\/infra\//;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });

const importsOf = (file: string): string[] =>
  [
    ...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1] ?? '');

const violations = (layer: RegExp, forbidden: (specifier: string) => boolean) =>
  sourceFiles(SRC)
    .filter((file) => layer.test(`/${relative(SRC, file)}`))
    .flatMap((file) =>
      importsOf(file)
        .filter(forbidden)
        .map((specifier) => `${relative(SRC, file)} → ${specifier}`),
    );

describe('architecture boundaries', () => {
  it('keeps domain and kernel free of frameworks and outer layers', () => {
    const found = violations(
      /\/(domain|shared\/kernel)\//,
      (s) => FRAMEWORK.test(s) || OUTER_LAYER.test(s) || /\/application\//.test(s),
    );
    expect(found).toEqual([]);
  });

  it('keeps application free of frameworks and infrastructure', () => {
    const found = violations(/\/application\//, (s) => FRAMEWORK.test(s) || OUTER_LAYER.test(s));
    expect(found).toEqual([]);
  });
});
