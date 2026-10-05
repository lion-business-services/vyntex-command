// The service catalog of the sample firm: generic services of an accounting and business-services office, with made-up
// sample prices (they are not anyone's real fees) and the playbooks that start with them.
// Service ids are fixed because leads, engagements and the cross-sell rules point at them; tier ids are `<service>-t<n>`.
// Appointment types at1 to at5 are the starter set of the edition (pack.appointmentTypes), in that order.
import type { CatalogTier, DocKind, Lang, Playbook, PlaybookStep, Repeat } from '@/domain/types';
import type { PlaybookFull, Service } from '@/domain/actions/catalog';
import { txFor } from './util';

type Unit = CatalogTier['unit'];
interface Tier { en: string; es: string; price: number; unit: Unit; noteEn?: string; noteEs?: string }
interface Svc { id: string; code: string; category: string; en: string; es: string; aboutEn: string; aboutEs: string; tiers: Tier[]; repeat?: Repeat; playbookId?: string; docKinds?: DocKind[]; appointmentTypeId?: string; active?: boolean; internalNote?: [string, string] }

const std = (price: number, unit: Unit): Tier[] => [{ en: 'Standard', es: 'Estándar', price, unit }];

const SERVICES: Svc[] = [
  { id: 's-1040', code: 'TAX-IND', category: 'tax', en: 'Individual tax return', es: 'Declaración de impuestos personal', repeat: 'yearly', playbookId: 'pb-return', docKinds: ['engagement_letter', 'consent_7216'], appointmentTypeId: 'at4',
    aboutEn: 'Federal and state return for one person or a couple, prepared from the documents the client brings.', aboutEs: 'Declaración federal y estatal de una persona o pareja, preparada con los documentos que trae el cliente.',
    tiers: [{ en: 'Standard', es: 'Estándar', price: 180, unit: 'flat' }, { en: 'With a business schedule', es: 'Con anexo de negocio', price: 320, unit: 'flat', noteEn: 'Self-employment or rental income.', noteEs: 'Ingresos por cuenta propia o de renta.' }] },
  { id: 's-biztax', code: 'TAX-BIZ', category: 'tax', en: 'Business tax return', es: 'Declaración de impuestos de negocio', repeat: 'yearly', playbookId: 'pb-return', docKinds: ['engagement_letter'],
    aboutEn: 'Yearly return of a company, prepared from its books.', aboutEs: 'Declaración anual de una empresa, preparada con su contabilidad.',
    tiers: [{ en: 'Single owner', es: 'Un solo dueño', price: 650, unit: 'flat' }, { en: 'Partnership or corporation', es: 'Sociedad o corporación', price: 900, unit: 'flat' }] },
  { id: 's-salestax', code: 'TAX-SALES', category: 'tax', en: 'Sales tax return', es: 'Declaración de impuesto sobre ventas', repeat: 'quarterly', docKinds: ['service_agreement'],
    aboutEn: 'Prepared and filed each quarter from the sales records the client sends.', aboutEs: 'Se prepara y se presenta cada trimestre con los registros de ventas que envía el cliente.', tiers: std(90, 'quarter') },
  { id: 's-amend', code: 'TAX-AMEND', category: 'tax', en: 'Amended tax return', es: 'Declaración enmendada', docKinds: ['engagement_letter'],
    aboutEn: 'Corrects a return that was already filed.', aboutEs: 'Corrige una declaración que ya se presentó.', tiers: std(150, 'flat') },
  { id: 's-extension', code: 'TAX-EXT', category: 'tax', en: 'Extension request', es: 'Solicitud de prórroga',
    aboutEn: 'Asks for more time to file. It does not move the date a payment is due.', aboutEs: 'Pide más tiempo para presentar. No cambia la fecha en que vence un pago.', tiers: std(45, 'flat') },
  { id: 's-notice', code: 'TAX-NOTICE', category: 'tax', en: 'Tax notice response', es: 'Respuesta a un aviso de impuestos', docKinds: ['engagement_letter', 'poa_2848'], appointmentTypeId: 'at4',
    aboutEn: 'Reads a letter from a tax agency with the client and answers it.', aboutEs: 'Se revisa con el cliente la carta de una agencia de impuestos y se responde.',
    tiers: [{ en: 'One notice', es: 'Un aviso', price: 110, unit: 'flat' }, { en: 'Representation', es: 'Representación', price: 0, unit: 'flat', noteEn: 'Quoted after reading the notice.', noteEs: 'Se cotiza después de leer el aviso.' }],
    internalNote: ['Ask for the whole letter, every page, before quoting.', 'Pida la carta completa, todas las páginas, antes de cotizar.'] },
  { id: 's-books', code: 'BK-MONTH', category: 'bookkeeping', en: 'Monthly bookkeeping', es: 'Contabilidad mensual', repeat: 'monthly', playbookId: 'pb-monthly', docKinds: ['service_agreement', 'service_order'], appointmentTypeId: 'at5',
    aboutEn: 'Records sales and expenses, reconciles the bank and card accounts and sends a monthly summary.', aboutEs: 'Registra ventas y gastos, concilia las cuentas de banco y tarjeta y envía un resumen mensual.',
    tiers: [{ en: 'Up to 50 transactions', es: 'Hasta 50 movimientos', price: 220, unit: 'month' }, { en: 'Up to 150 transactions', es: 'Hasta 150 movimientos', price: 340, unit: 'month' }] },
  { id: 's-cleanup', code: 'BK-CATCH', category: 'bookkeeping', en: 'Bookkeeping catch-up', es: 'Puesta al día de la contabilidad', docKinds: ['service_order'],
    aboutEn: 'Brings books that fell behind up to date, billed by the hour.', aboutEs: 'Pone al día una contabilidad atrasada; se cobra por hora.', tiers: std(60, 'hour') },
  { id: 's-payroll', code: 'PR-RUN', category: 'payroll', en: 'Payroll processing', es: 'Procesamiento de nómina', repeat: 'monthly', docKinds: ['service_agreement'],
    aboutEn: 'Runs each pay period, keeps the payroll records and prepares the payroll filings.', aboutEs: 'Corre cada periodo de pago, lleva los registros de nómina y prepara las declaraciones de nómina.',
    tiers: [{ en: 'Up to 5 employees', es: 'Hasta 5 empleados', price: 85, unit: 'month' }, { en: '6 to 15 employees', es: 'De 6 a 15 empleados', price: 140, unit: 'month' }] },
  { id: 's-wageforms', code: 'PR-YE', category: 'payroll', en: 'Year-end wage forms', es: 'Formularios de salarios de fin de año', repeat: 'yearly',
    aboutEn: 'Prepares and files the year-end forms for employees and other people the business paid.', aboutEs: 'Prepara y presenta los formularios de fin de año de los empleados y de otras personas a quienes pagó el negocio.',
    tiers: [{ en: 'Up to 10 forms', es: 'Hasta 10 formularios', price: 130, unit: 'year' }, { en: '11 to 30 forms', es: 'De 11 a 30 formularios', price: 260, unit: 'year' }] },
  { id: 's-formation', code: 'FORM-NEW', category: 'formation', en: 'Company formation', es: 'Constitución de empresa', playbookId: 'pb-formation', docKinds: ['engagement_letter', 'service_order'], appointmentTypeId: 'at1',
    aboutEn: 'Forms a new company and registers it with the state. State fees are separate.', aboutEs: 'Constituye una empresa nueva y la registra ante el estado. Las cuotas del estado van aparte.',
    tiers: [{ en: 'Single owner', es: 'Un solo dueño', price: 420, unit: 'flat' }, { en: 'With partners', es: 'Con socios', price: 560, unit: 'flat' }] },
  { id: 's-taxid', code: 'FORM-TAXID', category: 'formation', en: 'Tax ID application for a business', es: 'Solicitud de identificación fiscal para un negocio',
    aboutEn: 'Requests the federal tax ID a new business needs to open accounts and hire.', aboutEs: 'Solicita la identificación fiscal federal que un negocio nuevo necesita para abrir cuentas y contratar.', tiers: std(80, 'flat') },
  { id: 's-annual', code: 'LIC-ANNUAL', category: 'licensing', en: 'Annual report filing', es: 'Presentación del informe anual', repeat: 'yearly', docKinds: ['service_order'],
    aboutEn: 'Prepares and files the yearly report that keeps a company in good standing with the state.', aboutEs: 'Prepara y presenta el informe anual que mantiene a la empresa al corriente ante el estado.', tiers: std(110, 'year') },
  { id: 's-license', code: 'LIC-RENEW', category: 'licensing', en: 'Business license renewal', es: 'Renovación de licencia comercial', repeat: 'yearly',
    aboutEn: 'Renews a local business license before it runs out.', aboutEs: 'Renueva una licencia comercial local antes de que venza.', tiers: std(95, 'year') },
  { id: 's-advisory', code: 'ADV-HOUR', category: 'advisory', en: 'Advisory session', es: 'Sesión de asesoría', appointmentTypeId: 'at5',
    aboutEn: 'An hour with a senior associate to go over the numbers and plan ahead.', aboutEs: 'Una hora con un asociado sénior para revisar los números y planear.', tiers: std(120, 'hour') },
  // retired: it stays on the engagements that used it and cannot be picked for new ones
  { id: 's-paper', code: 'TAX-PAPER', category: 'other', en: 'Paper filing by mail', es: 'Presentación en papel por correo', active: false,
    aboutEn: 'Printing and mailing a return. Returns are filed electronically now.', aboutEs: 'Imprimir y enviar una declaración por correo. Ahora las declaraciones se presentan de forma electrónica.', tiers: std(25, 'flat') },
];

type Step = [en: string, es: string, dueIn: number, who: PlaybookStep['for'], type?: string, pri?: PlaybookStep['pri']];
const steps = (id: string, list: Step[]): PlaybookStep[] => list.map(([en, es, dueIn, who, type, pri], i) => ({ id: `${id}-s${i + 1}`, title: { en, es }, dueIn, for: who, ...(type ? { type } : {}), ...(pri ? { pri } : {}) }));

const WELCOME = {
  return: {
    en: 'Hello {{name}},\n\nThank you for choosing {{company}} for your {{service}}. {{responsible}} will look after it. The next step is the list of documents we need from you; we will send it today.\n\nIf anything is unclear, answer this message or call the office.',
    es: 'Hola, {{name}}:\n\nGracias por elegir a {{company}} para su {{service}}. {{responsible}} se encargará de atenderle. El siguiente paso es la lista de documentos que necesitamos de usted; se la enviaremos hoy.\n\nSi tiene alguna duda, responda a este mensaje o llame a la oficina.',
  },
  monthly: {
    en: 'Hello {{name}},\n\nWelcome to {{company}}. We are setting up your {{service}} and {{responsible}} is your contact from now on. In the next few days we will ask for your statements and agree with you on the day of the month you receive your summary.',
    es: 'Hola, {{name}}:\n\nLe damos la bienvenida a {{company}}. Estamos preparando su {{service}} y {{responsible}} será su contacto a partir de ahora. En los próximos días le pediremos sus estados de cuenta y acordaremos con usted el día del mes en que recibirá su resumen.',
  },
};

export function catalog(lang: Lang): { catalog: Service[]; playbooks: Playbook[] } {
  const tx = txFor(lang);
  const services: Service[] = SERVICES.map((s) => ({
    id: s.id, code: s.code, category: s.category, name: tx(s.en, s.es), description: tx(s.aboutEn, s.aboutEs), active: s.active !== false,
    i18n: { en: { name: s.en, description: s.aboutEn }, es: { name: s.es, description: s.aboutEs } },
    tiers: s.tiers.map((t, i) => ({ id: `${s.id}-t${i + 1}`, name: tx(t.en, t.es), price: t.price, unit: t.unit, ...(t.noteEn ? { note: tx(t.noteEn, t.noteEs ?? t.noteEn) } : {}) })),
    ...(s.repeat ? { repeat: s.repeat } : {}), ...(s.playbookId ? { playbookId: s.playbookId } : {}), ...(s.docKinds ? { docKinds: s.docKinds } : {}),
    ...(s.appointmentTypeId ? { appointmentTypeId: s.appointmentTypeId } : {}), ...(s.internalNote ? { internalNote: tx(...s.internalNote) } : {}),
  }));
  const playbooks: PlaybookFull[] = [
    { id: 'pb-return', name: tx('Tax return, start to filing', 'Declaración de impuestos, de inicio a presentación'), active: true, welcome: tx(WELCOME.return.en, WELCOME.return.es), welcomeI18n: WELCOME.return,
      steps: steps('pb-return', [
        ['Send the client the list of documents needed', 'Enviar al cliente la lista de documentos necesarios', 0, 'assignee', 'document', 'high'],
        ['Enter the documents and prepare the draft return', 'Capturar los documentos y preparar el borrador de la declaración', 7, 'assignee'],
        ['Check the draft return', 'Revisar el borrador de la declaración', 10, 'manager', 'review'],
        ['Go over the return with the client and get the signature', 'Repasar la declaración con el cliente y obtener la firma', 12, 'assignee', 'call'],
        ['File the return and deliver the copies', 'Presentar la declaración y entregar las copias', 14, 'assignee', undefined, 'high'],
      ]) },
    // each month of bookkeeping is its own engagement, so this list runs again for every month
    { id: 'pb-monthly', name: tx('Bookkeeping, month by month', 'Contabilidad, mes a mes'), active: true, welcome: tx(WELCOME.monthly.en, WELCOME.monthly.es), welcomeI18n: WELCOME.monthly,
      steps: steps('pb-monthly', [
        ['Ask for the statements of the month', 'Pedir los estados de cuenta del mes', 1, 'assignee', 'document'],
        ['Record the month and reconcile the accounts', 'Registrar el mes y conciliar las cuentas', 10, 'assignee'],
        ['Check the month before it goes out', 'Revisar el mes antes de enviarlo', 14, 'manager', 'review'],
        ['Send the monthly summary to the client', 'Enviar el resumen mensual al cliente', 15, 'assignee', undefined, 'high'],
      ]) },
    // no welcome message of its own: the edition's welcome email is prepared instead
    { id: 'pb-formation', name: tx('New company, step by step', 'Empresa nueva, paso a paso'), active: true,
      steps: steps('pb-formation', [
        ['Confirm the company name and the owners', 'Confirmar el nombre de la empresa y los dueños', 0, 'assignee', 'call', 'high'],
        ['Call to welcome the new client', 'Llamar para dar la bienvenida al nuevo cliente', 1, 'owner', 'call', 'low'],
        ['Prepare and file the formation papers', 'Preparar y presentar los documentos de constitución', 3, 'assignee', 'document'],
        ['Request the tax ID of the company', 'Solicitar la identificación fiscal de la empresa', 5, 'assignee'],
        ['Deliver the company papers and explain what comes next', 'Entregar los documentos de la empresa y explicar los siguientes pasos', 10, 'assignee'],
      ]) },
  ];
  return { catalog: services, playbooks };
}
