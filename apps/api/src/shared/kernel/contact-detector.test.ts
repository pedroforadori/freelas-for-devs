import { describe, expect, it } from 'vitest';
import { CONTACT_MASK, maskContacts, RegexContactDetector } from './contact-detector.js';

const detector = new RegexContactDetector();
const mask = (text: string) => maskContacts(detector, text);

/**
 * Corpus de tentativas reais de passar contato no Brasil. Critério da F3: 100% mascarado, sem
 * sobrar dígito de telefone, @, domínio ou nome de app no texto final.
 */
const LEAKS: [string, string][] = [
  ['telefone com DDD', 'me liga 11 98765-4321 que a gente acerta'],
  ['telefone com parênteses', 'meu celular é (21) 99876.5432'],
  ['telefone colado', 'chama 11987654321'],
  ['telefone com +55', 'contato: +55 (11) 9 8765 4321'],
  ['telefone por extenso', 'meu zap é nove nove oito sete seis cinco quatro três dois um'],
  ['telefone com meia', 'liga no um um meia meia sete oito nove nove oito'],
  ['telefone misto', 'é 11 nove 8765 4321'],
  ['telefone espaçado', '9 9 8 7 6 5 4 3 2'],
  ['e-mail', 'manda para ana.dev@gmail.com'],
  ['e-mail com arroba', 'ana arroba gmail ponto com'],
  ['e-mail com (at)', 'ana (at) hotmail (dot) com'],
  ['e-mail com espaços', 'ana @ gmail . com'],
  ['link https', 'meu portfólio: https://anadev.com.br/contato'],
  ['domínio solto', 'acessa anadev.com.br'],
  ['domínio com ponto por extenso', 'acessa anadev ponto com ponto br'],
  ['linktree', 'tudo em linktr.ee/anadev'],
  ['wa.me', 'clica em wa.me/5511987654321'],
  ['perfil @', 'me segue no @ana.dev'],
  ['whatsapp', 'fala comigo no whatsapp'],
  ['zap', 'me chama no zap'],
  ['telegram', 'tenho telegram também'],
  ['instagram', 'olha meu insta'],
];

const SAFE: [string, string][] = [
  ['valores e prazos', 'Faço por R$ 3.200 em 30 dias, com 3 entregas.'],
  ['data e hora', 'Posso entregar dia 12/10 às 14h.'],
  ['versões', 'Uso React 19.2 e Node 22.11.0.'],
  ['repositório permitido', 'O código está em https://github.com/anadev/padaria'],
  ['preview permitido', 'Veja em https://padaria-preview.vercel.app'],
  ['texto comum', 'Vou ajustar o rodapé e o cardápio hoje mesmo.'],
  ['e-mail sem domínio', 'o campo de e-mail do formulário vai validar o @'],
];

describe('RegexContactDetector', () => {
  it.each(LEAKS)('masks %s', (_label, text) => {
    const result = mask(text);
    expect(result.kinds.length).toBeGreaterThan(0);
    expect(result.text).toContain(CONTACT_MASK);
    // Nada do contato pode sobrar: nenhuma sequência de 4+ dígitos, @handle ou domínio.
    expect(result.text).not.toMatch(/\d{4,}/);
    expect(result.text).not.toMatch(/@\w/);
    expect(result.text).not.toMatch(/\.(com|br|ee|me)\b/);
    expect(result.text).not.toMatch(/\b(whats|zap|telegram|insta)/i);
  });

  it.each(SAFE)('keeps %s untouched', (_label, text) => {
    expect(mask(text)).toEqual({ text, kinds: [] });
  });

  it('keeps the surrounding text and reports every kind found', () => {
    const result = mask('Oi! Meu email é ana@gmail.com e o zap 11 98765-4321, combinado?');
    expect(result.text.startsWith('Oi! ')).toBe(true);
    expect(result.text.endsWith(', combinado?')).toBe(true);
    expect(result.text).not.toMatch(/ana@|98765/);
    expect(result.kinds.sort()).toEqual(['EMAIL', 'MESSAGING_APP', 'PHONE']);
  });

  it('does not mistake a sentence break for a domain', () => {
    expect(mask('Fiz o layout. Com isso, sigo para o painel.').kinds).toEqual([]);
  });
});
