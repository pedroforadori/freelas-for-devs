import { cn } from '@f4d/ui/cn';
import { buttonClasses } from '@f4d/ui/components/button';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  type CardTone,
  clientSteps,
  ctaBanner,
  differentials,
  faq,
  firstProject,
  freelancerSteps,
  hero,
  projectCards,
  stackStrip,
} from '@/content/home';
import { ctaHref, site } from '@/lib/site';
import {
  ArrowBadge,
  CtaIllustration,
  HeroIllustration,
  Logo,
  ProjectTypeIllustration,
  Sparkle,
} from './illustrations';

/** Grade do layout: 1240 px de conteúdo (1440 − 2×100 no Figma), gutter próprio em telas menores. */
export const container = 'mx-auto w-full max-w-content px-4 sm:px-6 xl:px-0';

const NAV = [
  { href: '#projetos', label: 'Projetos' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#primeiro-projeto', label: 'Para devs' },
  { href: '#faq', label: 'Dúvidas' },
];

/** Links que levam ao app recebem `data-app-link` para herdar os parâmetros UTM da visita. */
function CtaLink({
  audience,
  variant,
  children,
  className,
}: {
  audience: 'client' | 'freelancer';
  variant: 'primary' | 'outline' | 'accent';
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={ctaHref(audience)} data-app-link="" className={buttonClasses(variant, className)}>
      {children}
    </a>
  );
}

export function SiteHeader() {
  return (
    <header
      className={cn(container, 'flex items-center justify-between py-[10px] pt-6 md:pt-[60px]')}
    >
      <Link href="/" aria-label="Freelas 4 Devs — início">
        <Logo />
      </Link>
      <nav aria-label="Principal" className="hidden items-center gap-10 lg:flex">
        {NAV.map((item) => (
          <a key={item.href} href={item.href} className="text-lead hover:underline">
            {item.label}
          </a>
        ))}
        <CtaLink audience="client" variant="outline">
          {site.appLive ? 'Publicar projeto' : 'Entrar na lista'}
        </CtaLink>
      </nav>
      {/* Menu mobile sem JavaScript: <details> nativo. */}
      <details className="group relative lg:hidden">
        <summary className="flex size-12 cursor-pointer list-none items-center justify-center rounded-button border border-dark [&::-webkit-details-marker]:hidden">
          <span className="sr-only">Abrir menu</span>
          <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden className="stroke-dark">
            <path d="M4 7h16M4 12h16M4 17h16" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </summary>
        <div className="absolute right-0 z-10 mt-3 flex w-64 flex-col gap-4 rounded-[24px] border border-dark bg-bg p-6 shadow-brutal">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="text-lead">
              {item.label}
            </a>
          ))}
          <CtaLink audience="client" variant="primary" className="h-14">
            {site.appLive ? 'Publicar projeto' : 'Entrar na lista'}
          </CtaLink>
        </div>
      </details>
    </header>
  );
}

export function Hero() {
  return (
    <section
      className={cn(
        container,
        'grid items-center gap-10 pt-10 md:pt-[70px] lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]',
      )}
    >
      <div className="flex flex-col gap-[35px]">
        <h1 className="max-w-[560px] text-[2.6875rem] leading-[1.15] font-medium md:text-h1 md:leading-[1.15]">
          {hero.title}
        </h1>
        <p className="max-w-[498px] text-body md:text-lead">{hero.description}</p>
        <div className="flex flex-col gap-4 sm:flex-row">
          <CtaLink audience="client" variant="primary">
            {hero.primaryCta}
          </CtaLink>
          <CtaLink audience="freelancer" variant="outline">
            {hero.secondaryCta}
          </CtaLink>
        </div>
      </div>
      <HeroIllustration className="mx-auto h-auto w-full max-w-[520px] lg:max-w-none" />
    </section>
  );
}

export function StackStrip() {
  return (
    <section
      aria-label="Algumas das tecnologias dos nossos devs"
      className={cn(container, 'pt-16 md:pt-[70px]')}
    >
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 md:justify-between">
        {stackStrip.map((name) => (
          <li key={name} className="text-h4 font-medium text-muted md:text-[1.75rem]">
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}

const CARD_TONE: Record<
  CardTone,
  { card: string; pill: string; arrow: 'dark' | 'light'; text: string }
> = {
  surface: { card: 'bg-surface', pill: 'bg-accent', arrow: 'dark', text: 'text-dark' },
  accent: { card: 'bg-accent', pill: 'bg-bg', arrow: 'dark', text: 'text-dark' },
  dark: { card: 'bg-dark', pill: 'bg-bg', arrow: 'light', text: 'text-white' },
};

/** Seção com título em "pílula" e respiro do layout (~140 px entre seções no desktop). */
function Section({
  id,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        container,
        'flex scroll-mt-8 flex-col gap-10 pt-24 md:gap-20 md:pt-[140px]',
        className,
      )}
    >
      <SectionHeading id={`${id}-title`} title={title}>
        {intro}
      </SectionHeading>
      {children}
    </section>
  );
}

export function ProjectTypes() {
  return (
    <Section
      id="projetos"
      title="Projetos"
      intro="Do site da padaria ao sistema da clínica: se é software, tem dev certo para o seu projeto."
    >
      <ul className="grid gap-10 md:grid-cols-2">
        {projectCards.map((card) => {
          const tone = CARD_TONE[card.tone];
          return (
            <li key={card.type}>
              <article
                className={cn(
                  'flex h-full items-center justify-between gap-6 rounded-card border border-dark p-8 shadow-brutal md:p-[50px]',
                  tone.card,
                  tone.text,
                )}
              >
                <div className="flex flex-col gap-10 md:gap-[60px]">
                  <div className="flex flex-col gap-4">
                    <h3 className="flex flex-col items-start text-h4 font-medium md:text-h3">
                      {card.title.map((line) => (
                        <span
                          key={line}
                          className={cn('rounded-pill px-[7px] text-dark', tone.pill)}
                        >
                          {line}
                        </span>
                      ))}
                    </h3>
                    <p className="max-w-[260px] text-base">{card.description}</p>
                  </div>
                  <a href="#como-funciona" className="flex items-center gap-[15px] text-lead">
                    <ArrowBadge tone={tone.arrow} />
                    Como funciona<span className="sr-only"> — {card.title.join(' ')}</span>
                  </a>
                </div>
                <ProjectTypeIllustration
                  type={card.type}
                  className="hidden h-auto w-[150px] shrink-0 sm:block lg:w-[210px]"
                />
              </article>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function CtaBanner() {
  return (
    <section aria-labelledby="cta-title" className={cn(container, 'pt-24 md:pt-[100px]')}>
      <div className="relative flex items-center overflow-hidden rounded-card bg-surface px-8 py-12 md:min-h-[347px] md:px-[60px]">
        <div className="relative z-10 flex max-w-[500px] flex-col gap-[26px]">
          <h2 id="cta-title" className="text-h3 font-medium">
            {ctaBanner.title}
          </h2>
          <p className="text-body">{ctaBanner.description}</p>
          <CtaLink audience="client" variant="primary" className="self-start">
            {ctaBanner.cta}
          </CtaLink>
        </div>
        <CtaIllustration className="absolute -right-6 top-1/2 hidden h-auto w-[360px] -translate-y-1/2 md:block lg:right-16" />
      </div>
    </section>
  );
}

export function Differentials() {
  return (
    <Section
      id="diferenciais"
      title="Por que aqui"
      intro="Feito para quem nunca contratou um dev — e para quem quer fazer isso sem dor de cabeça."
    >
      <div className="grid gap-10 rounded-card bg-dark px-8 py-12 text-white md:grid-cols-3 md:gap-0 md:px-[60px] md:py-[70px]">
        {differentials.map((item, index) => (
          <div
            key={item.title}
            className={cn(
              'flex flex-col gap-5 md:px-8',
              index > 0 && 'md:border-l md:border-white/60',
              index === 0 && 'md:pl-0',
            )}
          >
            <h3 className="text-h4 font-medium text-accent">{item.title}</h3>
            <p className="text-body">{item.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Item de accordion nativo (sem JS): primeiro aberto, cor de destaque quando aberto. */
function AccordionItem({
  index,
  title,
  children,
  open,
}: {
  index?: number;
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details
      open={open}
      className="group rounded-card border border-dark bg-surface px-6 py-6 shadow-brutal open:bg-accent md:px-[60px] md:py-[41px]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-4 md:gap-[25px]">
          {index !== undefined ? (
            <span className="text-[2.5rem] leading-none font-medium md:text-h1 md:leading-none">
              {String(index + 1).padStart(2, '0')}
            </span>
          ) : null}
          <span className="text-h4 font-medium md:text-h3">{title}</span>
        </span>
        <span
          aria-hidden
          className="grid size-[44px] shrink-0 place-items-center rounded-full border border-dark bg-surface md:size-[58px]"
        >
          <svg viewBox="0 0 24 24" width={22} height={22} className="stroke-dark">
            <path d="M5 12h14" strokeWidth={3.5} strokeLinecap="round" />
            <path
              d="M12 5v14"
              strokeWidth={3.5}
              strokeLinecap="round"
              className="group-open:hidden"
            />
          </svg>
        </span>
      </summary>
      <div className="mt-6 border-t border-dark pt-6 text-body md:mt-[30px] md:pt-[30px]">
        {children}
      </div>
    </details>
  );
}

export function HowItWorks() {
  return (
    <Section
      id="como-funciona"
      title="Como funciona"
      intro="Simples para quem contrata, justo para quem desenvolve."
    >
      <div className="flex flex-col gap-6">
        <h3 id="para-clientes" className="scroll-mt-8 text-h3 font-medium">
          Para quem contrata
        </h3>
        <div className="flex flex-col gap-[30px]">
          {clientSteps.map((step, index) => (
            <AccordionItem key={step.title} index={index} title={step.title} open={index === 0}>
              {step.text}
            </AccordionItem>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <h3 id="para-freelancers" className="scroll-mt-8 text-h3 font-medium">
          Para quem desenvolve
        </h3>
        <div className="flex flex-col gap-[30px]">
          {freelancerSteps.map((step, index) => (
            <AccordionItem key={step.title} index={index} title={step.title} open={index === 0}>
              {step.text}
            </AccordionItem>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function FirstProject() {
  return (
    <Section id="primeiro-projeto" title="Primeiro projeto" intro={firstProject.intro}>
      <ul className="grid gap-10 md:grid-cols-2">
        {firstProject.cards.map((card, index) => (
          <li key={card.title}>
            <article className="flex h-full flex-col gap-6 rounded-card border border-dark bg-bg px-8 py-10 shadow-brutal md:px-[35px] md:py-[40px]">
              <div className="flex items-center gap-5">
                <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden className="shrink-0">
                  <circle
                    cx={32}
                    cy={32}
                    r={31}
                    className={index % 2 === 0 ? 'fill-accent stroke-dark' : 'fill-dark'}
                  />
                  <Sparkle
                    cx={32}
                    cy={32}
                    r={16}
                    className={index % 2 === 0 ? 'fill-dark' : 'fill-accent'}
                  />
                </svg>
                <h3 className="text-h4 font-medium">{card.title}</h3>
              </div>
              <p className="border-t border-dark pt-6 text-body">{card.text}</p>
            </article>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-6 rounded-card bg-surface px-8 py-10 md:flex-row md:items-center md:justify-between md:px-[60px]">
        <div className="flex max-w-[460px] flex-col gap-3">
          <h3 className="text-h4 font-medium">Suba de nível pelo seu trabalho</h3>
          <p className="text-body">
            Sem prova técnica: entregas no prazo, boas avaliações e projetos concluídos contam.
          </p>
        </div>
        <ol aria-label="Níveis" className="flex flex-wrap items-center gap-2">
          {firstProject.levels.map((level, index) => (
            <li key={level} className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded-pill border border-dark px-3 py-1 text-body',
                  index === 0 ? 'bg-accent' : 'bg-bg',
                )}
              >
                {level}
              </span>
              {index < firstProject.levels.length - 1 ? <span aria-hidden>→</span> : null}
            </li>
          ))}
        </ol>
      </div>
      <CtaLink audience="freelancer" variant="primary" className="self-start">
        Quero entrar como dev
      </CtaLink>
    </Section>
  );
}

export function Faq() {
  return (
    <Section id="faq" title="Dúvidas" intro="O que mais perguntam antes de começar.">
      <div className="flex flex-col gap-[30px]">
        {faq.map((item, index) => (
          <AccordionItem key={item.question} title={item.question} open={index === 0}>
            {item.answer}
          </AccordionItem>
        ))}
      </div>
    </Section>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className={cn(container, 'pt-24 md:pt-[140px]')}>
      <div className="flex flex-col gap-[50px] rounded-t-card bg-dark px-8 pt-[55px] pb-[50px] text-white md:px-[60px]">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <Logo inverted />
          <nav aria-label="Rodapé" className="flex flex-wrap gap-x-10 gap-y-3 text-body">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="underline">
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-[27px]">
            <h2 className="w-fit rounded-pill bg-accent px-[7px] text-lead font-medium text-dark">
              Contato
            </h2>
            <a href={`mailto:${site.contactEmail}`} className="text-body underline">
              {site.contactEmail}
            </a>
          </div>
          <div className="flex flex-col gap-5 rounded-button bg-dark-soft px-8 py-10 sm:flex-row sm:items-center lg:px-10 lg:py-[58px]">
            <p className="max-w-[285px] text-body">Seja avisado quando abrirmos para o público.</p>
            <a href="#lista-de-espera" className={buttonClasses('accent')}>
              Entrar na lista
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-white pt-[50px] text-body sm:flex-row sm:gap-10">
          <p>© {year} Freelas 4 Devs. Todos os direitos reservados.</p>
          <Link href="/privacidade" className="underline">
            Política de privacidade
          </Link>
          <Link href="/termos" className="underline">
            Termos de uso
          </Link>
        </div>
      </div>
    </footer>
  );
}
