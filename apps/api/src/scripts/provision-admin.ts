/**
 * Cria um Admin (ou promove uma conta existente). Não existe rota HTTP para isso.
 *
 *   pnpm --filter @f4d/api admin:provision --email fundador@freelas4devs.com.br --name "Fundador"
 *
 * Imprime o link para definir a senha (válido por 24 h) e também o envia por e-mail.
 * No primeiro acesso, o painel exige configurar o 2FA antes de qualquer ação administrativa.
 */
import { parseArgs } from 'node:util';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { emailSchema } from '@f4d/contracts';
import { infrastructureModules } from '../app.module.js';
import { ProvisionAdmin } from '../modules/identity/application/admin-use-cases.js';
import { IdentityModule } from '../modules/identity/identity.module.js';
import { MailModule } from '../shared/infra/mail/mail.module.js';

@Module({ imports: [...infrastructureModules, MailModule, IdentityModule] })
class ProvisionAdminCliModule {}

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
});
const email = emailSchema.safeParse(values.email);
if (!email.success || !values.name?.trim()) {
  process.stderr.write('Uso: admin:provision --email <e-mail> --name "<nome>"\n');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(ProvisionAdminCliModule, {
  logger: ['error', 'warn'],
});
try {
  const result = await app
    .get(ProvisionAdmin)
    .execute({ email: email.data, displayName: values.name.trim() });
  process.stdout.write(
    [
      result.created
        ? `Admin criado: ${email.data}`
        : `Conta existente promovida a Admin: ${email.data}`,
      `Defina a senha em até 24 h: ${result.passwordSetupUrl}`,
      'No primeiro acesso, configure a verificação em duas etapas (obrigatória para Admin).',
      '',
    ].join('\n'),
  );
} finally {
  await app.close();
}
