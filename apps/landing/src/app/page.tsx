import { UtmPropagation } from '@/components/utm-propagation';
import {
  CtaBanner,
  Differentials,
  Faq,
  FirstProject,
  Hero,
  HowItWorks,
  ProjectTypes,
  SiteFooter,
  SiteHeader,
  StackStrip,
} from '@/components/sections';
import { WaitlistSection } from '@/components/waitlist-section';
import { homeJsonLd, jsonLdScript } from '@/lib/jsonld';
import { buildMetadata, site } from '@/lib/site';

export const metadata = buildMetadata({
  title: 'Contrate devs freelancers para seu projeto',
  description: site.description,
  path: '/',
});

export default function HomePage() {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-20 focus:rounded-button focus:bg-accent focus:px-4 focus:py-2"
      >
        Pular para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo">
        <Hero />
        <StackStrip />
        <ProjectTypes />
        <CtaBanner />
        <Differentials />
        <HowItWorks />
        <FirstProject />
        <Faq />
        <WaitlistSection />
      </main>
      <SiteFooter />
      <UtmPropagation />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd) }}
      />
    </>
  );
}
