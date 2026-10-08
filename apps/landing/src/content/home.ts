import type { ProjectType } from '@f4d/contracts';

/**
 * Textos da home. Separados da apresentação para facilitar revisão de copy e, no futuro,
 * migrar para um CMS sem mexer nos componentes.
 */

export const hero = {
  title: 'Seu projeto de software com o dev certo, sem precisar saber quanto custa',
  description:
    'Descreva sua ideia em poucas linhas. A gente estima na hora, fecha o escopo com você e conecta seu projeto a devs analisados — com o pagamento protegido até a entrega.',
  primaryCta: 'Publicar projeto grátis',
  secondaryCta: 'Sou dev, quero projetos',
};

/** Faixa de stacks no lugar de logos de clientes (que só entram quando forem reais). */
export const stackStrip = [
  'React',
  'Next.js',
  'Node.js',
  'WordPress',
  'Shopify',
  'Flutter',
  'Laravel',
  'Python',
];

export type CardTone = 'surface' | 'accent' | 'dark';

export const projectCards: {
  type: ProjectType | 'ESTIMATE';
  title: [string, string];
  description: string;
  tone: CardTone;
}[] = [
  {
    type: 'SITE',
    title: ['Sites', 'institucionais'],
    description: 'Presença profissional, rápida e fácil de encontrar no Google.',
    tone: 'surface',
  },
  {
    type: 'ECOMMERCE',
    title: ['Lojas', 'virtuais'],
    description: 'Shopify, WooCommerce, Nuvemshop ou sob medida.',
    tone: 'accent',
  },
  {
    type: 'APP',
    title: ['Apps', 'mobile'],
    description: 'iOS e Android para o seu negócio ou a sua ideia.',
    tone: 'dark',
  },
  {
    type: 'SYSTEM',
    title: ['Sistemas', 'e painéis'],
    description: 'Agendamentos, gestão, áreas de cliente, integrações.',
    tone: 'surface',
  },
  {
    type: 'OTHER',
    title: ['Outro', 'projeto'],
    description: 'Automação, bot, ajuste em algo que já existe.',
    tone: 'accent',
  },
  {
    type: 'ESTIMATE',
    title: ['Não sabe', 'o preço?'],
    description: 'Descreva a ideia e receba uma faixa de preço e prazo na hora.',
    tone: 'dark',
  },
];

export const ctaBanner = {
  title: 'Sua ideia em 2 minutos',
  description:
    'Escreva com suas palavras o que você precisa. Sem formulário técnico, sem orçamento para preencher: a estimativa vem na hora.',
  cta: 'Descrever meu projeto',
};

export const differentials = [
  {
    title: 'Escopo fechado antes de começar',
    text: 'Um especialista conversa com você e transforma a ideia em escopo claro: funcionalidades, telas, prazo e faixa de preço.',
  },
  {
    title: 'Pagamento protegido',
    text: 'Você paga ao contratar, mas o valor fica em custódia e só vai para o dev quando você aprova a entrega final.',
  },
  {
    title: 'Três rodadas de entrega',
    text: 'Entrega completa, ajustes e versão final — com prazo em cada etapa e mediação se algo sair do combinado.',
  },
];

export const clientSteps = [
  {
    title: 'Descreva sua ideia',
    text: 'Título e uma descrição com suas palavras. Você pode escrever antes de criar conta.',
  },
  {
    title: 'Receba a estimativa na hora',
    text: 'Nossa IA sugere tipo de projeto, faixa de preço e prazo. Se faltar informação, faz 2 ou 3 perguntas rápidas.',
  },
  {
    title: 'Feche o escopo com um especialista',
    text: 'Pelo chat da plataforma, ajustamos juntos objetivo, funcionalidades, telas, prazo e critérios de aceite.',
  },
  {
    title: 'Escolha entre propostas',
    text: 'Devs compatíveis com o seu projeto enviam propostas dentro da faixa combinada. Você escolhe com calma.',
  },
  {
    title: 'Acompanhe as entregas',
    text: 'Primeira entrega completa, uma lista de ajustes e a versão final. Tudo registrado na plataforma.',
  },
  { title: 'Aprove e pronto', text: 'Só depois da sua aprovação o pagamento é liberado ao dev.' },
];

export const freelancerSteps = [
  {
    title: 'Crie seu perfil, sem testes técnicos',
    text: 'Mostre stacks, portfólio, GitHub e projetos publicados. Seu trabalho fala por você.',
  },
  {
    title: 'Análise do perfil',
    text: 'O time revisa seu perfil e define seu nível inicial — com orientações se algo precisar de ajuste.',
  },
  {
    title: 'Entre na fila do seu nível',
    text: 'Iniciantes disputam com iniciantes. Ninguém compra posição na fila.',
  },
  {
    title: 'Receba convites compatíveis',
    text: 'Cada projeto vai para os próximos devs compatíveis com o tipo e a stack, em rodadas.',
  },
  {
    title: 'Envie sua proposta',
    text: 'Valor e prazo dentro da faixa do escopo — sem leilão de preço para baixo.',
  },
  {
    title: 'Suba de nível pelo seu histórico',
    text: 'Entregas no prazo, boas avaliações e projetos concluídos levam você a projetos maiores.',
  },
];

export const firstProject = {
  intro:
    'Conseguir o primeiro projeto não deveria depender de pagar por destaque. Aqui a fila é justa — e o cliente continua bem servido.',
  cards: [
    {
      title: 'Sem vantagem paga',
      text: 'Não existe destaque, prioridade ou proposta extra à venda. Todos do nível recebem convites por rodada.',
    },
    {
      title: 'Fila por nível',
      text: 'Projetos de nível inicial vão para devs de nível inicial. Você não compete com quem tem dez anos de mercado.',
    },
    {
      title: 'Prioridade quando não é escolhido',
      text: 'Enviou proposta e o cliente escolheu outro? Você mantém prioridade na rodada seguinte.',
    },
    {
      title: 'Feedback de verdade',
      text: 'Você fica sabendo por que outra proposta foi escolhida — preço, portfólio, prazo — e pode melhorar.',
    },
  ],
  levels: ['Iniciante', 'Intermediário', 'Avançado', 'Especialista'],
};

export const faq = [
  {
    question: 'Quanto custa publicar um projeto?',
    answer:
      'Nada. Publicar, receber a estimativa e conversar sobre o escopo é grátis. Você só paga ao escolher um dev — e o valor fica protegido até a entrega.',
  },
  {
    question: 'Não faço ideia de quanto meu projeto custa. Tudo bem?',
    answer:
      'É exatamente para isso que a plataforma existe. Você descreve a ideia e recebe uma faixa de preço e prazo na hora; depois, um especialista fecha o escopo com você antes de qualquer pagamento.',
  },
  {
    question: 'Como funciona o pagamento protegido?',
    answer:
      'Ao escolher a proposta, você paga por um gateway de pagamento. O valor fica em custódia e só é liberado ao dev quando você aprova a entrega final. Não guardamos dados de cartão.',
  },
  {
    question: 'E se a entrega não sair como combinado?',
    answer:
      'São três rodadas: entrega completa, ajustes e versão final. Pedidos fora do escopo são combinados à parte, e qualquer divergência é mediada pelo nosso time com base no escopo e no histórico do chat.',
  },
  {
    question: 'Sou dev iniciante. Tenho chance de verdade?',
    answer:
      'Sim. A distribuição é por nível e em rodadas: projetos de nível inicial vão para quem está começando, e ninguém compra posição na fila.',
  },
  {
    question: 'Como a plataforma ganha dinheiro?',
    answer:
      'Com uma comissão sobre cada projeto, igual para todos. Nunca vendemos destaque ou prioridade — isso quebraria a justiça da fila.',
  },
  {
    question: 'Que tipos de projeto posso publicar?',
    answer:
      'Sites, lojas virtuais, apps, sistemas e painéis, automações e ajustes em projetos existentes. Se for software, pode publicar.',
  },
  {
    question: 'Meus dados estão seguros?',
    answer:
      'Seguimos a LGPD: pedimos só o necessário, você pode exportar ou excluir seus dados, e contatos pessoais não circulam no chat antes da contratação.',
  },
];

export const waitlist = {
  title: 'Lista de espera',
  description:
    'Estamos abrindo aos poucos. Deixe seu contato e avisamos você primeiro — clientes e devs.',
  consent:
    'Concordo em receber e-mails da Freelas 4 Devs sobre o lançamento. Posso cancelar quando quiser.',
};
