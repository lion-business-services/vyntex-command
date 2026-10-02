// Preview mode only (see PREVIEW in router.tsx): an embedded preview cannot print or save files, so those two actions
// explain themselves instead of silently doing nothing. On the hosted site this file does nothing.
import { PREVIEW } from './router';
import { currentT } from '@/store/store';
import { toast } from '@/ui';

export function installPreviewGuards() {
  if (!PREVIEW) return;
  window.print = () => toast(currentT()('preview.noPrint'));
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.hasAttribute('download')) { toast(currentT()('preview.noDownload')); return; }
    return click.call(this);
  };
}
