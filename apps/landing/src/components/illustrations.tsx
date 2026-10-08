import type { ProjectType } from '@f4d/contracts';
import { cn } from '@f4d/ui/cn';
import type { SVGProps } from 'react';

/**
 * Ilustrações próprias da Freelas 4 Devs (traço escuro + acento lima), inspiradas no estilo
 * do template Positivus mas desenhadas do zero — os assets do template são de terceiros.
 * Decorativas: `aria-hidden`, o conteúdo está no texto ao lado.
 */

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Estrela de 4 pontas (motivo recorrente do layout). */
export function Sparkle({
  cx,
  cy,
  r,
  className,
}: {
  cx: number;
  cy: number;
  r: number;
  className?: string;
}) {
  const k = r * 0.18;
  const d = `M${cx},${cy - r} C${cx + k},${cy - k} ${cx + k},${cy - k} ${cx + r},${cy} C${cx + k},${cy + k} ${cx + k},${cy + k} ${cx},${cy + r} C${cx - k},${cy + k} ${cx - k},${cy + k} ${cx - r},${cy} C${cx - k},${cy - k} ${cx - k},${cy - k} ${cx},${cy - r} Z`;
  return <path d={d} className={className} />;
}

const svgBase = (props: SVGProps<SVGSVGElement>) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export function HeroIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...svgBase(props)}
      viewBox="0 0 600 520"
      width={600}
      height={520}
      className={cn('text-dark', props.className)}
    >
      {/* Órbitas */}
      {[0, 34, 68].map((offset) => (
        <ellipse
          key={offset}
          cx={300}
          cy={280 + offset}
          rx={285}
          ry={72}
          transform={`rotate(-22 300 ${280 + offset})`}
          fill="none"
          {...stroke}
          strokeWidth={1.5}
        />
      ))}
      {/* Janela de código */}
      <rect x={150} y={120} width={300} height={230} rx={26} className="fill-bg" {...stroke} />
      <path d="M150 166 H450" {...stroke} />
      {[178, 198, 218].map((x) => (
        <circle key={x} cx={x} cy={143} r={5} className="fill-dark" />
      ))}
      <rect x={196} y={204} width={208} height={86} rx={18} className="fill-accent" {...stroke} />
      <path
        d="M250 225 L226 247 L250 269 M350 225 L374 247 L350 269 M314 220 L286 274"
        fill="none"
        {...stroke}
        strokeWidth={7}
      />
      <path d="M196 314 H330 M196 330 H280" {...stroke} strokeWidth={4} />
      {/* Selos: entrega aprovada, pagamento protegido, conversa */}
      <circle cx={486} cy={110} r={40} className="fill-dark" />
      <path
        d="M468 110 L481 123 L505 98"
        fill="none"
        stroke="#b9ff66"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={108} cy={372} r={40} className="fill-accent" {...stroke} />
      <path
        d="M108 350 L128 358 V374 C128 386 119 394 108 398 C97 394 88 386 88 374 V358 Z"
        className="fill-bg"
        {...stroke}
      />
      <circle cx={514} cy={340} r={36} className="fill-bg" {...stroke} />
      <path d="M496 328 H532 V350 H512 L502 360 V350 H496 Z" className="fill-accent" {...stroke} />
      {/* Estrelas e pontos */}
      <Sparkle cx={86} cy={178} r={36} className="fill-dark" />
      <Sparkle cx={520} cy={460} r={24} className="fill-accent stroke-dark" />
      <Sparkle cx={426} cy={472} r={13} className="fill-dark" />
      <circle cx={160} cy={66} r={18} className="fill-dark" />
      <circle cx={568} cy={232} r={10} className="fill-accent" {...stroke} />
    </svg>
  );
}

function CardFrame({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)} viewBox="0 0 210 170" width={210} height={170}>
      {children}
    </svg>
  );
}

/** Ilustração de cada card de tipo de projeto. `currentColor` segue a cor do texto do card. */
export function ProjectTypeIllustration({
  type,
  ...props
}: { type: ProjectType | 'ESTIMATE' } & SVGProps<SVGSVGElement>) {
  switch (type) {
    case 'SITE':
      return (
        <CardFrame {...props}>
          <rect x={30} y={22} width={150} height={118} rx={14} fill="none" {...stroke} />
          <path d="M30 46 H180" {...stroke} />
          <circle cx={46} cy={34} r={3} fill="currentColor" />
          <circle cx={58} cy={34} r={3} fill="currentColor" />
          <rect x={46} y={60} width={118} height={34} rx={8} className="fill-accent" {...stroke} />
          <path d="M46 108 H120 M46 122 H96" {...stroke} strokeWidth={4} />
          <Sparkle cx={180} cy={140} r={14} className="fill-accent stroke-dark" />
        </CardFrame>
      );
    case 'ECOMMERCE':
      return (
        <CardFrame {...props}>
          <path d="M58 58 H152 L144 146 H66 Z" className="fill-bg" {...stroke} />
          <path
            d="M82 58 V46 C82 33 92 24 105 24 C118 24 128 33 128 46 V58"
            fill="none"
            {...stroke}
          />
          <circle cx={150} cy={118} r={24} className="fill-dark" {...stroke} />
          <text x={150} y={125} textAnchor="middle" fontSize={20} fontWeight={500} fill="#b9ff66">
            %
          </text>
          <path d="M84 92 H126 M84 108 H112" {...stroke} strokeWidth={4} />
          <Sparkle cx={42} cy={40} r={13} className="fill-dark" />
        </CardFrame>
      );
    case 'APP':
      return (
        <CardFrame {...props}>
          <rect x={72} y={14} width={68} height={142} rx={16} className="fill-bg" {...stroke} />
          <path d="M96 26 H116" {...stroke} strokeWidth={4} />
          <rect x={82} y={40} width={48} height={52} rx={8} className="fill-accent" {...stroke} />
          <path d="M84 106 H128 M84 120 H114" {...stroke} strokeWidth={4} />
          <rect x={146} y={52} width={46} height={30} rx={8} className="fill-bg" {...stroke} />
          <path d="M156 67 L163 74 L180 60" fill="none" {...stroke} />
          <rect x={20} y={96} width={42} height={28} rx={8} className="fill-dark" {...stroke} />
          <Sparkle cx={36} cy={50} r={12} className="fill-accent stroke-dark" />
        </CardFrame>
      );
    case 'SYSTEM':
      return (
        <CardFrame {...props}>
          <rect x={22} y={20} width={166} height={124} rx={14} className="fill-bg" {...stroke} />
          <path d="M22 44 H188 M62 44 V144" {...stroke} />
          <path d="M34 60 H50 M34 74 H50 M34 88 H50" {...stroke} strokeWidth={4} />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={78 + i * 24}
              y={124 - (i + 1) * 16}
              width={14}
              height={(i + 1) * 16}
              rx={3}
              className={i === 3 ? 'fill-accent' : 'fill-dark'}
              {...stroke}
            />
          ))}
          <circle cx={168} cy={70} r={14} className="fill-accent" {...stroke} />
          <path d="M168 56 V70 H182" fill="none" {...stroke} />
        </CardFrame>
      );
    case 'OTHER':
      return (
        <CardFrame {...props}>
          <path
            d="M60 52 L105 85 L150 52 M105 85 V132"
            fill="none"
            {...stroke}
            strokeDasharray="6 6"
          />
          <circle cx={60} cy={48} r={22} className="fill-bg" {...stroke} />
          <circle cx={150} cy={48} r={22} className="fill-dark" {...stroke} />
          <circle cx={105} cy={88} r={26} className="fill-accent" {...stroke} />
          <path d="M96 80 L114 96 M114 80 L96 96" {...stroke} strokeWidth={4} />
          <rect x={83} y={124} width={44} height={30} rx={8} className="fill-bg" {...stroke} />
          <Sparkle cx={176} cy={128} r={13} className="fill-dark" />
        </CardFrame>
      );
    case 'ESTIMATE':
      return (
        <CardFrame {...props}>
          <rect x={56} y={18} width={98} height={136} rx={14} className="fill-bg" {...stroke} />
          <rect x={70} y={32} width={70} height={30} rx={6} className="fill-accent" {...stroke} />
          <text x={105} y={53} textAnchor="middle" fontSize={16} fontWeight={500} fill="#191a23">
            R$ ?
          </text>
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={70 + col * 25}
                y={74 + row * 24}
                width={18}
                height={16}
                rx={4}
                className="fill-dark"
              />
            )),
          )}
          <Sparkle cx={170} cy={34} r={18} className="fill-accent stroke-dark" />
          <Sparkle cx={36} cy={130} r={12} className="fill-accent stroke-dark" />
        </CardFrame>
      );
  }
}

export function CtaIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...svgBase(props)}
      viewBox="0 0 360 320"
      width={360}
      height={320}
      className={cn('text-dark', props.className)}
    >
      {[0, 22, 44].map((offset) => (
        <ellipse
          key={offset}
          cx={180}
          cy={190 + offset}
          rx={130}
          ry={30}
          fill="none"
          {...stroke}
          strokeWidth={1.5}
        />
      ))}
      <Sparkle cx={210} cy={110} r={92} className="fill-bg stroke-dark" />
      <circle cx={180} cy={190} r={52} className="fill-dark" />
      <path
        d="M168 176 L154 190 L168 204 M192 176 L206 190 L192 204"
        fill="none"
        stroke="#b9ff66"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Sparkle cx={290} cy={230} r={46} className="fill-placeholder/40" />
      <Sparkle cx={110} cy={268} r={44} className="fill-accent" />
    </svg>
  );
}

export function WaitlistIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...svgBase(props)}
      viewBox="0 0 360 520"
      width={360}
      height={520}
      className={cn('text-dark', props.className)}
    >
      {[70, 120, 170, 220, 270].map((r) => (
        <path
          key={r}
          d={`M360 ${260 - r} A ${r} ${r} 0 0 0 360 ${260 + r}`}
          fill="none"
          {...stroke}
          strokeWidth={1.5}
        />
      ))}
      <Sparkle cx={200} cy={240} r={90} className="fill-dark" />
      <Sparkle cx={110} cy={360} r={52} className="fill-accent" />
      <circle cx={290} cy={110} r={14} className="fill-accent" {...stroke} />
    </svg>
  );
}

/** Seta em círculo dos links "Saiba mais" (41 px no layout). */
export function ArrowBadge({ tone }: { tone: 'dark' | 'light' }) {
  const circle = tone === 'dark' ? 'fill-dark' : 'fill-bg';
  const arrow = tone === 'dark' ? '#b9ff66' : '#191a23';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 41 41"
      width={41}
      height={41}
      aria-hidden
      focusable={false}
    >
      <circle cx={20.5} cy={20.5} r={20.5} className={circle} />
      <path
        d="M13 28 L28 13 M17 13 H28 V24"
        fill="none"
        stroke={arrow}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Marca: estrela de 4 pontas + nome. */
export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 text-h4 font-medium ${inverted ? 'text-white' : 'text-dark'}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 36 36"
        width={32}
        height={32}
        aria-hidden
        focusable={false}
      >
        <Sparkle cx={18} cy={18} r={17} className={inverted ? 'fill-white' : 'fill-dark'} />
        <circle cx={18} cy={18} r={5} className="fill-accent" />
      </svg>
      Freelas 4 Devs
    </span>
  );
}
