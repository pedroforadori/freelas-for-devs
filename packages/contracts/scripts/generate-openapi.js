// Gera packages/contracts/openapi.json a partir das rotas declaradas em src/ (via dist/).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../dist/openapi.js';

const target = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
process.stdout.write(`OpenAPI gerado em ${target}\n`);
