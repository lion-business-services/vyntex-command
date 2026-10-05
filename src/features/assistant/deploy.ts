// What the assistant is called and whether it starts switched on, per deployment.
//   VYNTEX Command   "VYNTEX AI", on where the edition lists the module.
//   LBS Command      "Assistant", off until the firm switches it on: the owner decided to keep it away from client data
//                    by default. It is never called "VYNTEX AI" there.
// A company's own choice (Settings, `config.modules.assistant`) always wins over the default.
import type { CompanyConfig, L10n } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import { DEPLOY } from '@/config/deployment';

export const ASSISTANT_NAME: L10n = DEPLOY.id === 'lbs' ? { en: 'Assistant', es: 'Asistente', zh: '助手' } : { en: 'VYNTEX AI', es: 'VYNTEX AI' };
/** Whether the assistant is there before the company has said anything. */
export const assistantDefault = (pack: Pick<IndustryPack, 'modules'>): boolean => (DEPLOY.id === 'lbs' ? false : pack.modules.includes('assistant'));
/** Whether the assistant exists for this company: its own switch, or the deployment's default. */
export function assistantOn(d: { config?: CompanyConfig }, pack: Pick<IndustryPack, 'modules'>): boolean {
  const own = d.config?.modules?.assistant;
  return typeof own === 'boolean' ? own : assistantDefault(pack);
}
/** Switches the assistant on or off for the company. */
export function setAssistant(d: { config: CompanyConfig }, on: boolean): void {
  d.config = { ...d.config, modules: { ...d.config.modules, assistant: on } };
}
