// Settings: the web address of the workspace and whose brand it carries. A company's own address under the platform, or
// its own domain, is arranged with VYNTEX during setup: it involves the domain's records and a certificate, and it must
// not weaken the separation between companies, so there is nothing here to switch on by hand. This section says where the
// workspace is reached today and who to ask. It shows no control that would only pretend to change it.
import { LuGlobe, LuMail } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { appBase } from '@/app/router';
import { Badge, Card } from '@/ui';
import { DEPLOY } from '@/config/deployment';

export default function DomainSection() {
  const { t, live } = useApp();
  const address = (typeof location !== 'undefined' ? location.host : '') + appBase();
  return (
    <Card title={t('settings.domain.title')}>
      <p className="muted settings-lead">{t('settings.domain.intro')}</p>
      <div className="list" data-testid="settings-domain">
        <div className="item settings-rule">
          <span className="settings-conn-ic"><LuGlobe aria-hidden="true" /></span>
          <div className="grow">
            <div className="t">{t('settings.domain.now')} {!live && <Badge outline>{t('demo.sampleShort')}</Badge>}</div>
            <div className="small muted settings-wrap settings-mono">{address}</div>
          </div>
        </div>
        <div className="item settings-rule">
          <span className="settings-conn-ic"><LuGlobe aria-hidden="true" /></span>
          <div className="grow">
            <div className="t">{t('settings.domain.sub')} <Badge tone="accent" outline>{t('settings.domain.arranged')}</Badge></div>
            <div className="small muted">{t('settings.domain.subText')}</div>
          </div>
        </div>
        <div className="item settings-rule">
          <span className="settings-conn-ic"><LuGlobe aria-hidden="true" /></span>
          <div className="grow">
            <div className="t">{t('settings.domain.own')} <Badge tone="accent" outline>{t('settings.domain.arranged')}</Badge></div>
            <div className="small muted">{t('settings.domain.ownText')}</div>
          </div>
        </div>
      </div>
      <p className="small" style={{ marginTop: 14 }}><LuMail aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('settings.domain.ask')} <a href={`mailto:${DEPLOY.support.email}`}>{DEPLOY.support.email}</a></p>
    </Card>
  );
}
