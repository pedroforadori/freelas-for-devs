import { LEAD_CONSENT_VERSION } from '@f4d/contracts';
import { cn } from '@f4d/ui/cn';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { waitlist } from '@/content/home';
import { site } from '@/lib/site';
import { WaitlistIllustration } from './illustrations';
import { container } from './sections';
import { WaitlistForm } from './waitlist-form';

/** Componente de servidor: a versão do consentimento vem dos contratos sem levar Zod ao browser. */
export function WaitlistSection() {
  return (
    <section
      id="lista-de-espera"
      aria-labelledby="lista-de-espera-title"
      className={cn(container, 'flex scroll-mt-8 flex-col gap-10 pt-24 md:gap-20 md:pt-[140px]')}
    >
      <SectionHeading id="lista-de-espera-title" title={waitlist.title}>
        {waitlist.description}
      </SectionHeading>
      <div className="relative flex overflow-hidden rounded-card bg-surface px-6 pt-10 pb-12 sm:px-10 md:px-[100px] md:pt-[60px] md:pb-[80px]">
        <WaitlistForm
          apiUrl={site.apiUrl}
          consentVersion={LEAD_CONSENT_VERSION}
          consentText={waitlist.consent}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}
        />
        <WaitlistIllustration className="absolute top-1/2 right-0 hidden h-auto w-[300px] -translate-y-1/2 lg:block xl:w-[360px]" />
      </div>
    </section>
  );
}
