import type { EmailMessage } from './mailer.js';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** E-mail transacional padrão: parágrafos de texto (escapados) e um botão de ação. */
export const simpleEmail = (
  to: string,
  tag: string,
  subject: string,
  paragraphs: string[],
  cta: { label: string; url: string },
): EmailMessage => ({
  to,
  tag,
  subject,
  text: `${paragraphs.join('\n\n')}\n\n${cta.label}: ${cta.url}`,
  html: `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#191a23;background:#f3f3f3;padding:32px 16px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #191a23;border-radius:24px;padding:32px">
<p style="margin:0 0 24px;font-size:14px"><strong>Freelas 4 Devs</strong></p>
${paragraphs.map((p) => `<p style="line-height:1.5">${escapeHtml(p)}</p>`).join('\n')}
<p style="margin:32px 0 0"><a href="${cta.url}" style="background:#191a23;color:#fff;padding:16px 28px;border-radius:14px;text-decoration:none;display:inline-block">${cta.label}</a></p>
</div></body></html>`,
});
