import { buttonClasses } from '@f4d/ui/components/button';
import { buildMetadata, site } from '@/lib/site';

export const metadata = buildMetadata({
  title: 'Contrate devs freelancers para seu projeto',
  description: site.description,
  path: '/',
});

/** Esqueleto da home. As seções completas (docs/architecture.md §11) chegam na fase Landing L1. */
export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-9 px-4 py-16 md:px-0 md:py-24">
      <h1 className="max-w-[640px] text-[2.6875rem] leading-[1.28] font-medium md:text-h1">
        Tire seu projeto de software do papel sem precisar saber quanto custa
      </h1>
      <p className="max-w-[500px] text-body">
        Descreva o que você precisa. A gente estima na hora, fecha o escopo com você e conecta seu
        projeto a devs verificados — com pagamento protegido até a entrega.
      </p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <a className={buttonClasses('primary')} href={`${site.appUrl}/novo-projeto`}>
          Publicar projeto grátis
        </a>
        <a className={buttonClasses('outline')} href={`${site.appUrl}/cadastro?perfil=freelancer`}>
          Quero ser freelancer
        </a>
      </div>
    </main>
  );
}
