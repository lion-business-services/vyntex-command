// Cross-sell rules of the sample firm and the opportunities they produced. Every rule points at services of the sample
// catalog (seed/catalog.ts) and applies to at least one sample client, so none of them is a rule that can never fire.
// One client (pc5) matches the advisory rule and has no opportunity yet: the first time the rules run on the sample
// (they run when a workspace opens) that opportunity is created, so the screen shows one that is new today.
import type { CrossSellRule, Lang } from '@/domain/types';
import type { Opp } from '@/domain/actions/opportunities';
import { day, txFor } from './util';

export function opportunities(lang: Lang): { crossSell: CrossSellRule[]; opportunities: Opp[] } {
  const tx = txFor(lang);
  const crossSell: CrossSellRule[] = [
    { id: 'cs-books', name: tx('Business return without monthly books', 'Declaración de negocio sin contabilidad mensual'), whenServiceIds: ['s-biztax'], suggestServiceId: 's-books', unlessServiceIds: ['s-cleanup'], clientKind: 'business', active: true,
      note: tx('The yearly return goes faster and costs less to prepare when the books are kept every month. Offer the smaller tier to start.', 'La declaración anual sale más rápido y cuesta menos prepararla cuando la contabilidad se lleva cada mes. Ofrezca el nivel más pequeño para empezar.') },
    { id: 'cs-payroll', name: tx('Bookkeeping clients with employees', 'Clientes de contabilidad con empleados'), whenServiceIds: ['s-books'], suggestServiceId: 's-payroll', clientKind: 'business', active: true,
      note: tx('Ask who runs their payroll today and how long it takes them each pay period.', 'Pregunte quién corre su nómina hoy y cuánto tiempo le toma en cada periodo de pago.') },
    { id: 'cs-wageforms', name: tx('Payroll clients: year-end forms', 'Clientes de nómina: formularios de fin de año'), whenServiceIds: ['s-payroll'], suggestServiceId: 's-wageforms', delayDays: 21, active: true,
      note: tx('We already hold the payroll records, so the forms need nothing more from the client.', 'Ya tenemos los registros de nómina, así que los formularios no requieren nada más del cliente.') },
    { id: 'cs-advisory', name: tx('Individual return: a session to plan ahead', 'Declaración personal: una sesión para planear'), whenServiceIds: ['s-1040'], suggestServiceId: 's-advisory', clientKind: 'individual', delayDays: 30, active: true,
      note: tx('A good moment is a month after filing: go over withholding and what to set aside for next year.', 'Un buen momento es un mes después de presentar: revise las retenciones y cuánto apartar para el próximo año.') },
  ];
  const note = (id: string) => crossSell.find((r) => r.id === id)?.note;
  const opportunities: Opp[] = [
    { id: 'op1', clientId: 'pc7', serviceId: 's-books', ruleId: 'cs-books', status: 'open', created: day(-6), by: 'automation', value: 220, note: note('cs-books') },
    { id: 'op3', clientId: 'pc8', serviceId: 's-payroll', ruleId: 'cs-payroll', status: 'open', created: day(-2), by: 'automation', value: 85, note: note('cs-payroll') },
    { id: 'op2', clientId: 'pc6', serviceId: 's-wageforms', ruleId: 'cs-wageforms', status: 'contacted', created: day(-12), by: 'automation', value: 130, note: note('cs-wageforms') },
    { id: 'op5', clientId: 'pc1', serviceId: 's-advisory', ruleId: 'cs-advisory', status: 'won', created: day(-15), by: 'automation', value: 120, note: note('cs-advisory'), jobId: 'pe16' },
    { id: 'op4', clientId: 'pc2', serviceId: 's-advisory', ruleId: 'cs-advisory', status: 'dismissed', created: day(-9), by: 'automation', value: 120, note: note('cs-advisory'),
      dismissedReason: tx('Prefers to wait until next season.', 'Prefiere esperar a la próxima temporada.') },
  ];
  return { crossSell, opportunities };
}
