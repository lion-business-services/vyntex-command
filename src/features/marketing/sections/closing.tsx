// The closing call to action: the dimensional V on the right, the promise and the two actions on the left,
// and circuit traces that run from the mark toward the main button.
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { Arrow, CircuitTrace, Reveal, VMark3D } from '@/brand';
import './closing.css';

export function ClosingSection() {
  const { t } = useApp();
  return (
    <section className="mks-cl" aria-labelledby="mks-cl-h">
      <div className="mks-cl-in">
        <div className="mks-cl-copy">
          <Reveal as="h2" id="mks-cl-h"><span className="chrome-text">{t('mk.s.cl.h1')}</span> <span className="brand-text">{t('mk.s.cl.h2')}</span></Reveal>
          <Reveal as="p" delay={90}>{t('mk.s.cl.p')}</Reveal>
          <Reveal className="mks-cl-cta" delay={170}>
            <Link to="/request-demo" className="btn primary lg" data-testid="mk-close-request">{t('mk.s.cl.request')}<Arrow /></Link>
            <Link to="/demo" className="btn lg" data-testid="mk-close-demo">{t('mk.s.cl.demo')}</Link>
            <span className="mks-cl-wire" aria-hidden="true">
              {/* Drawn from the mark (right) toward the buttons (left). The drawing is wider than it is ever shown:
                  CircuitTrace measures its dash on screen, so a trace that is stretched would stop short of its end. */}
              <span>
                <CircuitTrace viewBox="0 0 1000 150" d="M860 16H750L662 50H440L340 90H0" />
                <CircuitTrace viewBox="0 0 1000 150" d="M960 90H0" />
                <CircuitTrace viewBox="0 0 1000 150" d="M1000 140H790L712 110H300L250 90H0" />
                <i />
              </span>
            </span>
          </Reveal>
        </div>
        <div className="mks-cl-art" aria-hidden="true">
          <VMark3D quiet className="mks-cl-mark" />
        </div>
      </div>
    </section>
  );
}
