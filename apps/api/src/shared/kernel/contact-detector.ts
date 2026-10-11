/**
 * Detecção de dados de contato em texto livre (chat, propostas): telefone, e-mail, links, perfis
 * (@usuario) e convites para apps de mensagem. Pura e determinística: o mesmo texto sempre gera o
 * mesmo resultado. A porta permite somar um detector por LLM no futuro (docs/architecture.md §5).
 */
export type ContactKind = 'PHONE' | 'EMAIL' | 'URL' | 'HANDLE' | 'MESSAGING_APP';

export interface ContactMatch {
  kind: ContactKind;
  start: number;
  end: number;
}

export interface ContactDetector {
  detect(text: string): ContactMatch[];
}

export const CONTACT_MASK = '[contato removido]';

/** Hosts de trabalho permitidos (repositório, protótipo, preview de deploy). */
export const ALLOWED_LINK_HOSTS = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'figma.com',
  'vercel.app',
  'netlify.app',
  'loom.com',
] as const;

/** Números por extenso (inclui "meia" = 6, comum ao ditar telefone no Brasil). */
const NUMBER_WORDS: Record<string, number> = {
  zero: 1,
  um: 1,
  uma: 1,
  dois: 1,
  duas: 1,
  tres: 1,
  quatro: 1,
  cinco: 1,
  seis: 1,
  meia: 1,
  sete: 1,
  oito: 1,
  nove: 1,
};

/** Mínimo de dígitos para ser telefone (fixo sem DDD tem 8). */
const PHONE_MIN_DIGITS = 8;

const stripAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Telefone: sequência de grupos de dígitos e números por extenso, separados por espaço, ponto,
 * hífen, parênteses, barra ou "+", que some ao menos 8 dígitos.
 */
const findPhones = (text: string): ContactMatch[] => {
  const matches: ContactMatch[] = [];
  const token = /\d+|[a-zà-ú]+|[^\s\da-zà-ú]/gi;
  let run: { start: number; end: number; digits: number } | null = null;
  const close = () => {
    if (run && run.digits >= PHONE_MIN_DIGITS)
      matches.push({ kind: 'PHONE', start: run.start, end: run.end });
    run = null;
  };
  for (const found of text.matchAll(token)) {
    const value = found[0];
    const start = found.index;
    const end = start + value.length;
    const word = stripAccents(value.toLowerCase());
    const digits = /^\d+$/.test(value) ? value.length : (NUMBER_WORDS[word] ?? 0);
    if (digits > 0) {
      if (run) {
        // Só emenda se o que há entre os grupos for separador típico de telefone.
        const gap = text.slice(run.end, start);
        if (/^[\s.\-()/+e]*$/i.test(gap)) {
          run.end = end;
          run.digits += digits;
          continue;
        }
        close();
      }
      run = { start, end, digits };
    } else if (!/^[.\-()/+]$/.test(value)) {
      close();
    }
  }
  close();
  return matches;
};

/** No e-mail aceitamos espaços em volta de "@" e "." (o @ obrigatório evita falso positivo). */
const AT = String.raw`\s*(?:@|\(?\s*(?:arroba|at)\s*\)?)\s*`;
const EMAIL_DOT = String.raw`\s*(?:\.|\(?\s*(?:ponto|dot)\s*\)?)\s*`;
/** Em links soltos, o ponto é literal ou por extenso — "site. Com isso" não vira domínio. */
const URL_DOT = String.raw`(?:\.|\s+ponto\s+|\s*\(\s*(?:ponto|dot)\s*\)\s*)`;
const TLD = String.raw`(?:com|net|org|br|io|dev|me|app|co|info|link|xyz|site|online|tech|bio|ly|gg|tv|ee|ai|to|sh|cc|us|uk|pt|fm|gl|li|page|store|shop)`;

const EMAIL = new RegExp(
  String.raw`[\p{L}\d._%+-]+${AT}[\p{L}\d-]+(?:${EMAIL_DOT}[\p{L}\d-]+)*${EMAIL_DOT}${TLD}\b`,
  'giu',
);
const URL_LIKE = new RegExp(
  String.raw`\bhttps?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+|\b[\p{L}\d-]+(?:${URL_DOT}[\p{L}\d-]+)*${URL_DOT}${TLD}\b(?:\/[^\s<>"]*)?`,
  'giu',
);
const HANDLE = /(?<![\p{L}\d.])@[\p{L}\d_.]{3,}/gu;
const MESSAGING_APP = new RegExp(
  String.raw`\b(?:whats\s*app|whatsapp|whats|zap\s*zap|zapzap|zap|wpp|wa\.me|telegram|telegrama|tg|insta(?:gram)?|signal|discord|skype|linkedin|facebook|face|messenger|me\s+liga|me\s+chama\s+no|meu\s+n[uú]mero|meu\s+(?:cel|celular|telefone|fone|email|e-mail))\b`,
  'giu',
);

const hostOf = (link: string): string | null => {
  try {
    const normalized = link.startsWith('http') ? link : `https://${link}`;
    return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

const isAllowedLink = (link: string): boolean => {
  const host = hostOf(link);
  return Boolean(
    host && ALLOWED_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)),
  );
};

const collect = (text: string, pattern: RegExp, kind: ContactKind): ContactMatch[] =>
  [...text.matchAll(pattern)].map((found) => ({
    kind,
    start: found.index,
    end: found.index + found[0].length,
  }));

/** Une trechos sobrepostos para mascarar cada região uma única vez. */
const merge = (matches: ContactMatch[]): ContactMatch[] => {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: ContactMatch[] = [];
  for (const match of sorted) {
    const last = merged.at(-1);
    if (last && match.start <= last.end) last.end = Math.max(last.end, match.end);
    else merged.push({ ...match });
  }
  return merged;
};

export class RegexContactDetector implements ContactDetector {
  detect(text: string): ContactMatch[] {
    const emails = collect(text, EMAIL, 'EMAIL');
    const links = collect(text, URL_LIKE, 'URL').filter(
      (match) =>
        !isAllowedLink(text.slice(match.start, match.end)) &&
        // Parte de um e-mail já detectado.
        !emails.some((email) => match.start >= email.start && match.end <= email.end),
    );
    return merge([
      ...findPhones(text),
      ...emails,
      ...links,
      ...collect(text, HANDLE, 'HANDLE'),
      ...collect(text, MESSAGING_APP, 'MESSAGING_APP'),
    ]);
  }
}

export interface MaskResult {
  text: string;
  kinds: ContactKind[];
}

/** Substitui cada trecho detectado pela máscara; devolve também os tipos encontrados. */
export const maskContacts = (detector: ContactDetector, text: string): MaskResult => {
  const matches = detector.detect(text);
  if (matches.length === 0) return { text, kinds: [] };
  let masked = '';
  let cursor = 0;
  for (const match of matches) {
    masked += text.slice(cursor, match.start) + CONTACT_MASK;
    cursor = match.end;
  }
  masked += text.slice(cursor);
  return { text: masked, kinds: [...new Set(matches.map((match) => match.kind))] };
};
