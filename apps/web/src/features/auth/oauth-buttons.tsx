import type { SelfAssignableRole } from '@f4d/contracts';
import { buttonClasses } from '@f4d/ui/components/button';
import { oauthStartUrl } from '@/lib/api';

/** Links de navegação completa: a API redireciona para o provedor e de volta. */
export function OAuthButtons({
  role,
  redirectTo,
}: {
  role?: SelfAssignableRole;
  redirectTo?: string;
}) {
  const options = { ...(role ? { role } : {}), ...(redirectTo ? { redirectTo } : {}) };
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <a
        className={buttonClasses('outline', 'h-14 flex-1')}
        href={oauthStartUrl('github', options)}
      >
        Continuar com GitHub
      </a>
      <a
        className={buttonClasses('outline', 'h-14 flex-1')}
        href={oauthStartUrl('google', options)}
      >
        Continuar com Google
      </a>
    </div>
  );
}

export function Divider({ label = 'ou' }: { label?: string }) {
  return (
    <div className="flex items-center gap-4 text-sm text-muted" role="separator">
      <span className="h-px flex-1 bg-dark/20" />
      {label}
      <span className="h-px flex-1 bg-dark/20" />
    </div>
  );
}
