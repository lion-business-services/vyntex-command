// Public pages reached by a private link (no sign-in). Each page lives in its own file with its own owner.
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { AuthFrame } from '@/features/auth/frame';
import { useTitle } from './title';
export { SignPage } from './sign';
export { ReviewPage } from './review';

/** An address that is nothing, in a deployment without sales pages. */
export function NotFound() {
  const { t } = useApp();
  useTitle(t('public.notFound.title'));
  return <AuthFrame title={t('public.notFound.title')} testId="public-notfound"><p>{t('public.notFound.body')}</p><div className="row"><Link to="/signin" className="btn primary">{t('public.notFound.signin')}</Link></div></AuthFrame>;
}
