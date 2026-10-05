// Wording of the payroll screen, English and Spanish (Chinese optional). Prefix every key with `payroll.`.
// No sentence here states a rate, a table or a filing date: the product has none.
import type { Dict } from '@/i18n';

export const dict: Dict = {
  en: {
    'payroll.sub': 'Payroll work for {clients}: what is recorded here, and the way to the firm\'s payroll application.',
    'payroll.today': 'Payroll itself runs in the firm\'s separate payroll application, which was not supplied for this build. Nothing is calculated on this screen: it gathers the payroll work already recorded in this workspace and links to that application.',
    'payroll.staffApp': 'Payroll application for the staff',
    'payroll.need.source': 'The source code of the payroll application the firm uses today, so its screens and rules are brought over instead of rewritten from guesses.',
    'payroll.need.records': 'The employee, pay period and payment records to move over, with totals to check them against before the switch.',
    'payroll.need.tables': 'The federal and state reference values the firm works with, each with its source and the date it takes effect. They are not included and are never estimated.',
    'payroll.need.rules': 'How the firm works out a pay run today, step by step, confirmed by the person responsible for payroll.',
    'payroll.need.signoff': 'A person at the firm who checks the results before any pay run of a {client} depends on them.',
    'payroll.never': 'No tax rate, withholding table or filing date exists anywhere in this product. Until the firm supplies them, this screen calculates nothing.',
  },
  es: {
    'payroll.sub': 'El trabajo de nómina para {clients}: lo que está registrado aquí y el acceso a la aplicación de nómina del despacho.',
    'payroll.today': 'La nómina en sí se corre en la aplicación de nómina propia del despacho, que no se entregó para esta versión. En esta pantalla no se calcula nada: reúne el trabajo de nómina que ya está en este espacio y enlaza con esa aplicación.',
    'payroll.staffApp': 'Aplicación de nómina para el equipo',
    'payroll.need.source': 'El código fuente de la aplicación de nómina que el despacho usa hoy, para traer sus pantallas y reglas en lugar de reescribirlas a base de suposiciones.',
    'payroll.need.records': 'Los registros de empleados, periodos de pago y pagos que se van a pasar, con totales para compararlos antes del cambio.',
    'payroll.need.tables': 'Los valores de referencia federales y estatales con los que trabaja el despacho, cada uno con su fuente y la fecha en que entra en vigor. No vienen incluidos y nunca se estiman.',
    'payroll.need.rules': 'Cómo calcula hoy el despacho una corrida de nómina, paso a paso, confirmado por la persona responsable de la nómina.',
    'payroll.need.signoff': 'Una persona del despacho que revise los resultados antes de que dependa de ellos la nómina de un {client}.',
    'payroll.never': 'En este producto no existe ninguna tasa de impuestos, tabla de retenciones ni fecha de presentación. Mientras el despacho no las entregue, esta pantalla no calcula nada.',
  },
};
