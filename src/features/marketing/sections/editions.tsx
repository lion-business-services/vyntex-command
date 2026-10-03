// The eight industry editions as one ruled list: who each is for, a few of its service types, and a way straight into
// its demo. Everything comes from the industry packs, so a new edition appears here without touching this file.
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { Arrow, useInView } from '@/brand';
import { PACK_LIST } from '@/packs';
import type { IndustryPack } from '@/packs/types';
import { switchPack } from '@/store/store';
import { cx } from '@/ui';
import { EditionName, Head } from './shared';
import './editions.css';

export function EditionsSection() {
  const { t, pack, lang } = useApp();
  // the list arrives as one piece (rows a beat apart), so no edition can be left hidden below the fold
  const { ref, seen } = useInView<HTMLUListElement>('0px 0px -8% 0px');
  const services = (p: IndustryPack) => p.serviceTypes.filter((s) => s.id !== 'other').slice(0, 4).map((s) => s[lang]);
  return (
    <section className="mks mks-ed" aria-labelledby="mks-ed-h">
      <Head id="mks-ed-h" title={t('mk.s.ed.h', { n: PACK_LIST.length })} sub={t('mk.s.ed.sub')} />
      <ul className={cx('mks-ed-list', seen && 'in')} ref={ref}>
        {PACK_LIST.map((p, i) => (
          <li key={p.id} style={{ ['--i' as string]: i }} className={cx('mks-ed-row', p.id === pack.id && 'on')}>
            <div className="mks-ed-name">
              <h3><EditionName pack={p} /></h3>
              <span>{p.label[lang]}{p.id === pack.id && <em>{t('mk.s.ed.current')}</em>}</span>
            </div>
            <div className="mks-ed-about">
              <p>{p.blurb[lang]}</p>
              <p className="mks-ed-types"><span className="sr">{t('mk.s.ed.services')}: </span>{services(p).join(', ')}</p>
            </div>
            <Link to="/demo" onClick={() => switchPack(p.id)} className="mks-link mks-ed-go" aria-label={t('mk.s.ed.exploreIn', { name: p.product })} data-testid={`mk-edition-${p.id}`}>
              <span>{t('mk.s.ed.explore')}</span><Arrow />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mks-ed-more">{t('mk.s.ed.more')} <Link to="/request-demo" className="mks-ed-ask" data-testid="mk-ed-ask">{t('mk.s.ed.ask')}</Link></p>
    </section>
  );
}
