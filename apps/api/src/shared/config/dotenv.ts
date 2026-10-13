/**
 * Desenvolvimento local: carrega `apps/api/.env` (se existir) com o leitor nativo do Node.
 * Não sobrescreve variáveis já definidas — em produção elas vêm do provedor e não há arquivo.
 * Importado primeiro pelos pontos de entrada (API, worker, migrações e scripts).
 */
import { existsSync } from 'node:fs';

if (process.env.NODE_ENV !== 'test' && existsSync('.env')) process.loadEnvFile('.env');
