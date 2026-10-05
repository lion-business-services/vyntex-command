// Professional services edition: an office that serves clients through engagements and appointments (tax, bookkeeping,
// payroll and business services). Everything that makes it different from the field editions is in this file:
// wording, pipeline, client and task types, roles, which screens exist, starter appointment types.
// The app core never checks the edition id.
import type { IndustryPack } from '../types';
import { practiceRules } from './rules';
import type { L10n, OfficeRole, StageDef } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { ALL_PERMISSIONS, FIELD_RULES } from '../blueprint';

/**
 * Working product name. Not approved by the owner yet: change it here and every screen follows.
 * "Pro" is avoided on purpose, because it is a plan name in the other editions.
 */
export const PRACTICE_PRODUCT = 'VYNTEX PRACTICE';

const l = (en: string, es: string, zh?: string): L10n => (zh ? { en, es, zh } : { en, es });

/** The pipeline of a professional-services office. A company can rename, add or remove stages in its settings. */
const STAGES: StageDef[] = [
  { id: 'new', label: l('New', 'Nuevo', '新线索'), kind: 'open', role: 'new' },
  { id: 'contacted', label: l('Contacted', 'Contactado', '已联系'), kind: 'open', role: 'contacted' },
  { id: 'appointment', label: l('Appointment set', 'Cita programada', '已预约'), kind: 'open', role: 'visit', hot: true },
  { id: 'proposal', label: l('Proposal sent', 'Propuesta enviada', '已发方案'), kind: 'open', role: 'proposal', hot: true },
  { id: 'negotiating', label: l('Negotiating', 'En negociación', '洽谈中'), kind: 'open', role: 'negotiation', hot: true },
  { id: 'won', label: l('Won', 'Ganado', '已成交'), kind: 'won' },
  { id: 'lost', label: l('Lost', 'Perdido', '已流失'), kind: 'lost' },
];

/** What an associate may look at. Read only is exactly this list. */
const VIEW: Permission[] = [
  'leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'assistant', 'appointments', 'catalog', 'opportunities', 'reviews', 'comms', 'esign',
  'cash', 'payroll', 'bookkeeping', 'licensing', 'deadlines', 'secureView',
];
/**
 * Owner: everything. Senior associate: runs the work, approves reveals and marks payments, sees the clients of their own
 * office. Associate: does the work, asks for a reveal instead of making one. Read only: looks, changes nothing.
 */
const ROLES: Record<OfficeRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: [...VIEW, 'reports', 'automations', 'social', 'delete', 'export', 'import', 'assignLeads', 'credits', 'secureReveal', 'secureApprove', 'write'],
  staff: [...VIEW, 'import', 'credits', 'write'],
  readonly: VIEW,
};

export const practicePack: IndustryPack = {
  id: 'practice',
  product: PRACTICE_PRODUCT,
  label: l('Professional services', 'Servicios profesionales', '专业服务'),
  blurb: l('For tax, bookkeeping, payroll and business-services offices.', 'Para oficinas de impuestos, contabilidad, nómina y servicios para negocios.'),
  ticketPrefix: 'VP-',
  recurring: true,
  // fictional firm; the sample business is in ./seed.ts
  sampleCompany: { name: 'Harbor Ledger Advisors', initials: 'HL', license: 'Sample firm for demonstration', phone: '609-555-0900', email: 'harborledger@example.com' },
  serviceTypes: [
    { id: 'tax', en: 'Tax preparation', es: 'Preparación de impuestos', zh: '报税' },
    { id: 'bookkeeping', en: 'Bookkeeping', es: 'Contabilidad', zh: '簿记' },
    { id: 'payroll', en: 'Payroll', es: 'Nómina', zh: '薪资' },
    { id: 'formation', en: 'Business formation', es: 'Formación de empresas', zh: '公司注册' },
    { id: 'licensing', en: 'Licenses and permits', es: 'Licencias y permisos', zh: '执照与许可' },
    { id: 'advisory', en: 'Advisory', es: 'Asesoría', zh: '咨询' },
    { id: 'other', en: 'Other', es: 'Otro', zh: '其他' },
  ],
  terms: {
    en: {
      owner: 'Owner', industry: 'Industry',
      projects: 'Engagements', project: 'Engagement', newProject: 'New engagement', back: 'All engagements', deleteProject: 'Delete engagement',
      name: 'Engagement name', noProjects: 'No engagements match. Clear the filters or add a new engagement.',
      forProject: 'Engagement', convert: 'Make it an engagement', converted: 'Engagement created', search: 'Search client or engagement',
      // the office team stands where the field editions have their crews; the screens about field workers do not exist here
      subs: 'Team', sub: 'Team member', workersPlural: 'Team members', newSub: 'New team member', subName: 'Full name', allSubs: 'Whole team', trade: 'Role',
      secAssign: 'Who is working on it', addAssign: 'Assign a team member', secSubPay: 'Payments to the team', addSubPay: 'Pay a team member', paySub: 'Pay a team member',
      paidSubs: 'Paid to the team', oweSubs: 'Owed to the team', subLabor: 'Team cost', secLog: 'Work notes',
      materials: 'Fees and costs', secPurch: 'Fees and costs', addPurch: 'Add a cost', desc: 'What it was for', vendor: 'Paid to',
      scope: 'What the engagement covers', payTerms: 'Fee and billing', contract: 'Fee', contractBtn: 'Engagement letter',
      activeProjects: 'Active engagements', contractValue: 'Active engagement value', activeList: 'Active engagements', contractTotal: 'Engagement total',
      address: 'Address', jobSite: 'Engagement', type: 'Service line', allTypes: 'All service lines',
      start: 'Start date', end: 'Due date', ev_start: 'Engagement starts', ev_end: 'Engagement due', ev_appt: 'Appointment', estAppt: 'Appointment', apptDate: 'Appointment date',
      repeat: 'Repeats', rp_once: 'One time', rp_weekly: 'Every week', rp_biweekly: 'Every 2 weeks', rp_monthly: 'Every month', rp_quarterly: 'Every quarter', rp_yearly: 'Every year',
      st_estimate: 'Proposal', st_contract: 'Waiting on signature', st_progress: 'In progress', pt_project: 'Per engagement (fixed fee)',
      thanks: 'Thank you for choosing {company}.', contractorSig: 'Firm', saveSig: 'Sign', consent: 'I agree to sign this document electronically and to receive it by email.',
      confirmReset: 'Throw away your edits and rebuild this document from the engagement details?',
      notePh: 'What did you talk about? What should the next person know?', pinIt: 'Pin to the top', noNotes: 'No notes yet. Write down what the client said so the next person has it.',
      'leads.visitOn': 'Appointment {date}', 'leads.schedule': 'Set an appointment', 'leads.reschedule': 'Change the appointment', 'leads.f.visitDate': 'Appointment date', 'leads.f.visitTime': 'Appointment time',
      'leads.lostPh': 'Fee, timing, chose another firm…', 'notif.apptToday': 'Appointment today', 'act.visit.scheduled': 'Appointment set for {date}',
      'auto.visit-prep.name': 'Appointment preparation', 'auto.visit-prep.when': 'An appointment is set with a lead', 'auto.visit-prep.then1': 'Put the appointment on the calendar',
      'auto.visit-prep.then2': 'Create a task to prepare for the appointment', 'auto.task.visitPrep': 'Prepare for the appointment with {lead}',
      'auto.estimate-follow-up.name': 'Proposal follow-up', 'auto.estimate-follow-up.when': 'A proposal is sent', 'auto.task.estimateFollowUp': 'Follow up on the proposal for {lead}',
      'auto.job-started.then2': 'Show the engagement to the person responsible',
      'auto.recurring-visits.name': 'Repeating engagements', 'auto.recurring-visits.then1': 'Put every upcoming date on the calendar',
      'auto.visitsPlanned': '{n} upcoming dates on the calendar', 'auto.visitsPlanned.one': '1 upcoming date on the calendar',
      'doc.kind.estimate': 'Proposal', 'doc.kind.contract': 'Engagement letter', 'docs.kinds.estimate': 'Proposals', 'docs.kinds.contract': 'Engagement letters',
      // the starter email that follows up on an estimate: this edition sends proposals and engagement letters
      'messages.tpl.estimate': 'Proposal follow-up', 'messages.tpl.estimate.subject': 'Following up on your proposal from {company}',
      'messages.tpl.estimate.body': 'Hello {name},\n\nI am following up on the proposal we sent you for {jobName}. Do you have any questions, or is there anything you would like to change?\n\nWhen you are ready to go ahead, reply to this email and we will prepare the engagement letter.\n\nThank you,\n{company}\n{phone}',
      'docs.p.est.intro': '{company} prepared this proposal for the {client} named below.', 'docs.p.est.scope': 'Services included', 'docs.p.est.price': 'Proposed fee',
      'docs.p.est.validH': 'About this proposal', 'docs.p.est.valid': 'This proposal lists the services requested and the fee quoted on its date. Ask the firm before relying on it after that date.',
      'docs.p.est.accept': 'To accept this proposal, sign and date below. The engagement letter is prepared next.',
      'calendar.newVisit': 'Set an appointment this day', 'calendar.visit.title': 'Set an appointment', 'calendar.visit.saved': 'Appointment set', 'calendar.ev_visit': 'Repeating work',
      'dash.ev.visit': 'Repeating work', 'dash.kpi.visitsThisWeek': 'Appointments and due dates, next 7 days', 'dash.hint.visits': 'Appointments and start dates',
      'jobs.f.repeatHint': 'Repeating work goes on the calendar by itself.', 'jobs.ov.nextVisits': 'Next dates',
      'reports.profit.note': 'Profit is the agreed fee minus the costs recorded on each engagement. Proposals are left out. Work that is still open shows the profit expected so far.',
      'jobs.tab.log': 'Notes', 'settings.perm.team': 'Team', 'clients.moneyNote': 'Billed counts every engagement past the proposal. The balance is what is still owed on work that started or finished.',
      'docs.emptyHint': 'Pick an engagement and its proposal, engagement letter or invoice is written from the details you already entered.',
      'clients.noDocs': 'No documents yet. Engagement letters and invoices are created from each engagement.',
    },
    es: {
      owner: 'Dueño', industry: 'Industria',
      projects: 'Encargos', project: 'Encargo', newProject: 'Nuevo encargo', back: 'Todos los encargos', deleteProject: 'Borrar encargo',
      name: 'Nombre del encargo', noProjects: 'Ningún encargo coincide. Quite los filtros o agregue uno.',
      forProject: 'Encargo', convert: 'Convertir en encargo', converted: 'Encargo creado', search: 'Buscar cliente o encargo',
      subs: 'Equipo', sub: 'Miembro del equipo', workersPlural: 'Miembros del equipo', newSub: 'Nuevo miembro del equipo', subName: 'Nombre completo', allSubs: 'Todo el equipo', trade: 'Función',
      secAssign: 'Quién lo trabaja', addAssign: 'Asignar a un miembro del equipo', secSubPay: 'Pagos al equipo', addSubPay: 'Pagar a un miembro del equipo', paySub: 'Pagar a un miembro del equipo',
      paidSubs: 'Pagado al equipo', oweSubs: 'Por pagar al equipo', subLabor: 'Costo del equipo', secLog: 'Notas de trabajo',
      materials: 'Cuotas y costos', secPurch: 'Cuotas y costos', addPurch: 'Agregar un costo', desc: 'Concepto', vendor: 'Pagado a',
      scope: 'Qué cubre el encargo', payTerms: 'Honorarios y cobro', contract: 'Honorarios', contractBtn: 'Carta de encargo',
      activeProjects: 'Encargos activos', contractValue: 'Valor de encargos activos', activeList: 'Encargos activos', contractTotal: 'Total del encargo',
      address: 'Dirección', jobSite: 'Encargo', type: 'Línea de servicio', allTypes: 'Todas las líneas de servicio',
      start: 'Fecha de inicio', end: 'Fecha límite', ev_start: 'Inicio del encargo', ev_end: 'Vence el encargo', ev_appt: 'Cita', estAppt: 'Cita', apptDate: 'Fecha de la cita',
      repeat: 'Se repite', rp_once: 'Una vez', rp_weekly: 'Cada semana', rp_biweekly: 'Cada 2 semanas', rp_monthly: 'Cada mes', rp_quarterly: 'Cada trimestre', rp_yearly: 'Cada año',
      st_estimate: 'Propuesta', st_contract: 'Esperando firma', st_progress: 'En curso', pt_project: 'Por encargo (honorario fijo)',
      thanks: 'Gracias por elegir a {company}.', contractorSig: "El despacho", saveSig: 'Firmar', consent: 'Acepto firmar este documento de forma electrónica y recibirlo por correo.',
      confirmReset: '¿Descartar sus cambios y volver a armar este documento con los datos del encargo?',
      notePh: '¿De qué hablaron? ¿Qué debe saber la siguiente persona?', pinIt: 'Fijar arriba', noNotes: 'Aún no hay notas. Anote lo que dijo el cliente para que la siguiente persona lo tenga.',
      'leads.visitOn': 'Cita {date}', 'leads.schedule': 'Programar una cita', 'leads.reschedule': 'Cambiar la cita', 'leads.f.visitDate': 'Fecha de la cita', 'leads.f.visitTime': 'Hora de la cita',
      'leads.lostPh': 'Honorarios, tiempos, eligió otro despacho…', 'notif.apptToday': 'Cita hoy', 'act.visit.scheduled': 'Cita programada para {date}',
      'auto.visit-prep.name': 'Preparación de la cita', 'auto.visit-prep.when': 'Se programa una cita con un prospecto', 'auto.visit-prep.then1': 'Poner la cita en el calendario',
      'auto.visit-prep.then2': 'Crear una tarea para preparar la cita', 'auto.task.visitPrep': 'Preparar la cita con {lead}',
      'auto.estimate-follow-up.name': 'Seguimiento de la propuesta', 'auto.estimate-follow-up.when': 'Se envía una propuesta', 'auto.task.estimateFollowUp': 'Dar seguimiento a la propuesta de {lead}',
      'auto.job-started.then2': 'Mostrar el encargo a la persona responsable',
      'auto.recurring-visits.name': 'Encargos recurrentes', 'auto.recurring-visits.then1': 'Poner cada fecha próxima en el calendario',
      'auto.visitsPlanned': '{n} fechas próximas en el calendario', 'auto.visitsPlanned.one': '1 fecha próxima en el calendario',
      'doc.kind.estimate': 'Propuesta', 'doc.kind.contract': 'Carta de encargo', 'docs.kinds.estimate': 'Propuestas', 'docs.kinds.contract': 'Cartas de encargo',
      'messages.tpl.estimate': 'Seguimiento de la propuesta', 'messages.tpl.estimate.subject': 'Seguimiento de su propuesta de {company}',
      'messages.tpl.estimate.body': 'Hola, {name}:\n\nLe escribo para dar seguimiento a la propuesta que le enviamos para {jobName}. ¿Tiene alguna pregunta o hay algo que quiera cambiar?\n\nCuando desee seguir adelante, responda a este correo y preparamos la carta de encargo.\n\nGracias,\n{company}\n{phone}',
      'docs.p.est.intro': '{company} preparó esta propuesta para el {client} nombrado abajo.', 'docs.p.est.scope': 'Servicios incluidos', 'docs.p.est.price': 'Honorarios propuestos',
      'docs.p.est.validH': 'Sobre esta propuesta', 'docs.p.est.valid': 'Esta propuesta indica los servicios solicitados y los honorarios cotizados en su fecha. Consulte con el despacho antes de darla por vigente después de esa fecha.',
      'docs.p.est.accept': 'Para aceptar esta propuesta, firme y ponga la fecha abajo. Después se prepara la carta de encargo.',
      'calendar.newVisit': 'Programar una cita este día', 'calendar.visit.title': 'Programar una cita', 'calendar.visit.saved': 'Cita programada', 'calendar.ev_visit': 'Trabajo recurrente',
      'dash.ev.visit': 'Trabajo recurrente', 'dash.kpi.visitsThisWeek': 'Citas y vencimientos, próximos 7 días', 'dash.hint.visits': 'Citas e inicios',
      'jobs.f.repeatHint': 'El trabajo recurrente entra solo al calendario.', 'jobs.ov.nextVisits': 'Próximas fechas',
      'reports.profit.note': 'La ganancia es el honorario acordado menos los costos registrados en cada encargo. No se cuentan las propuestas. Lo que sigue abierto muestra la ganancia esperada hasta ahora.',
      'jobs.tab.log': 'Notas', 'settings.perm.team': 'Equipo', 'clients.moneyNote': 'Lo facturado cuenta cada encargo que ya pasó de propuesta. El saldo es lo que aún se debe por trabajo iniciado o terminado.',
      'docs.emptyHint': 'Elija un encargo y su propuesta, carta de encargo o factura se redacta con los datos que ya capturó.',
      'clients.noDocs': 'Aún no hay documentos. Las cartas de encargo y las facturas se crean desde cada encargo.',
    },
  },
  jobStatuses: ['estimate', 'contract', 'progress', 'hold', 'done'],
  kpis: ['activeJobs', 'newLeads', 'pipelineValue', 'overdueTasks', 'clientsOwe', 'collectedMonth'],
  // Structure only. The firm's approved engagement letter wording has not been supplied, so no clause is written here:
  // every section is a heading with a placeholder the firm replaces. Nothing in it is legal or tax language.
  agreement: {
    en: {
      title: 'Engagement letter',
      intro: 'Between {company} and the client named below. [Opening paragraph: the firm adds its approved wording here.]',
      s1: '1. Services', s2: '2. Fees and billing', total: 'Fee for this engagement',
      s3: '3. Timing', sched: 'Start: {start}. Due: {end}. [The firm adds its approved wording about timing here.]',
      s4: '4. What the client provides', chg: '[The firm adds its approved wording here.]',
      s5: '5. What the firm is responsible for', ins: '[The firm adds its approved wording here.]',
      s6: '6. Ending the engagement', cxl: '[The firm adds its approved wording here.]',
      s7: '7. Signatures', esig: '[The firm adds its approved wording about signing electronically here.]',
      draft: 'Structure only. The approved engagement letter wording has not been added yet. Do not send this to a client until the firm has reviewed and replaced every bracketed part.',
    },
    es: {
      title: 'Carta de encargo',
      intro: 'Entre {company} y el cliente nombrado abajo. [Párrafo inicial: el despacho agrega aquí su texto aprobado.]',
      s1: '1. Servicios', s2: '2. Honorarios y cobro', total: 'Honorarios de este encargo',
      s3: '3. Plazos', sched: 'Inicio: {start}. Fecha límite: {end}. [El despacho agrega aquí su texto aprobado sobre los plazos.]',
      s4: '4. Lo que aporta el cliente', chg: '[El despacho agrega aquí su texto aprobado.]',
      s5: '5. De qué es responsable el despacho', ins: '[El despacho agrega aquí su texto aprobado.]',
      s6: '6. Terminación del encargo', cxl: '[El despacho agrega aquí su texto aprobado.]',
      s7: '7. Firmas', esig: '[El despacho agrega aquí su texto aprobado sobre la firma electrónica.]',
      draft: 'Solo estructura. Todavía no se agrega el texto aprobado de la carta de encargo. No la envíe a un cliente hasta que el despacho haya revisado y reemplazado cada parte entre corchetes.',
    },
  },
  kickoffTasks: [
    { en: 'Send the engagement letter for signature', es: 'Enviar la carta de encargo para firma', dueIn: 0, for: 'owner', pri: 'high' },
    { en: 'Ask the client for the documents needed', es: 'Pedir al cliente los documentos necesarios', dueIn: 1, for: 'owner', pri: 'high' },
    { en: 'Confirm the fee and how it will be billed', es: 'Confirmar los honorarios y cómo se van a cobrar', dueIn: 2, for: 'owner' },
    { en: 'Set the first working appointment', es: 'Programar la primera cita de trabajo', dueIn: 3, for: 'owner' },
  ],
  closeoutTasks: [
    { en: 'Send the final invoice', es: 'Enviar la factura final', dueIn: 0, for: 'owner', pri: 'high' },
    { en: 'Give the client copies of the finished work', es: 'Entregar al cliente copias del trabajo terminado', dueIn: 1, for: 'owner' },
    { en: 'Ask the client for a review', es: 'Pedir una reseña al cliente', dueIn: 3, for: 'owner', pri: 'low' },
    { en: 'Write down when this service is due again', es: 'Anotar cuándo vuelve a tocar este servicio', dueIn: 5, for: 'owner', pri: 'low' },
  ],
  // this flag means the subcontractor W-9 and 1099 screens, which a practice does not have
  compliance: false,

  family: 'practice',
  // not in the pricing file: no plan and no price are shown for this edition, it is quoted on request
  priced: false,
  modules: [
    'leads', 'clients', 'jobs', 'appointments', 'calendar', 'tasks', 'catalog', 'opportunities', 'documents', 'esign', 'messages', 'payments', 'reviews', 'deadlines',
    'reports', 'team', 'automations', 'integrations', 'social', 'cash', 'payroll', 'bookkeeping', 'licensing', 'assistant', 'settings', 'security', 'audit',
  ],
  leadStages: STAGES,
  leadSources: [
    { id: 'website', label: l('Website', 'Sitio web') }, { id: 'phone', label: l('Phone call', 'Llamada') }, { id: 'walk_in', label: l('Walk-in', 'Visita a la oficina') },
    { id: 'referral', label: l('Referral', 'Referido') }, { id: 'google', label: l('Google', 'Google') }, { id: 'facebook', label: l('Facebook', 'Facebook') },
    { id: 'instagram', label: l('Instagram', 'Instagram') }, { id: 'whatsapp', label: l('WhatsApp', 'WhatsApp') }, { id: 'existing_client', label: l('Existing client', 'Cliente actual') },
    { id: 'other', label: l('Other', 'Otro') },
  ],
  lostReasons: [
    { id: 'price', label: l('Fee too high', 'Honorarios muy altos') }, { id: 'competitor', label: l('Chose another firm', 'Eligió otro despacho') },
    { id: 'not_ready', label: l('Not ready yet', 'Todavía no está listo') }, { id: 'no_response', label: l('No response', 'Sin respuesta') },
    { id: 'not_a_fit', label: l('Not a fit', 'No era para nosotros') }, { id: 'other', label: l('Other', 'Otro') },
  ],
  taskTypes: [
    { id: 'todo', label: l('To do', 'Por hacer') }, { id: 'client_request', label: l('Client request', 'Solicitud del cliente') }, { id: 'call', label: l('Call', 'Llamada') },
    { id: 'document', label: l('Document', 'Documento') }, { id: 'review', label: l('Review', 'Revisión') },
  ],
  clientTypes: [
    { id: 'individual', label: l('Individual', 'Persona') }, { id: 'sole_prop', label: l('Sole proprietor', 'Propietario único') }, { id: 'llc', label: l('LLC', 'LLC') },
    { id: 's_corp', label: l('S corporation', 'Corporación S') }, { id: 'c_corp', label: l('C corporation', 'Corporación C') }, { id: 'partnership', label: l('Partnership', 'Sociedad') },
    { id: 'nonprofit', label: l('Nonprofit', 'Organización sin fines de lucro') },
  ],
  roleLabels: {
    owner: l('Owner', 'Dueño', '所有者'), manager: l('Senior associate', 'Asociado sénior', '高级专员'), staff: l('Associate', 'Asociado', '专员'), readonly: l('Read only', 'Solo lectura', '只读'),
  },
  rolePermissions: ROLES,
  docKinds: ['engagement_letter', 'service_agreement', 'service_order', 'consent_7216', 'poa_2848', 'estimate', 'contract', 'invoice', 'upload', 'custom'],
  // starter set for a new company. Fees are zero on purpose: what an appointment costs is the firm's decision, not ours.
  appointmentTypes: [
    { name: l('First consultation', 'Primera consulta'), minutes: 30, fee: 0, prepay: false, mode: 'office', buffer: 10, active: true },
    { name: l('Phone consultation', 'Consulta por teléfono'), minutes: 20, fee: 0, prepay: false, mode: 'phone', active: true },
    { name: l('Video consultation', 'Consulta por video'), minutes: 30, fee: 0, prepay: false, mode: 'video', buffer: 5, active: true },
    { name: l('Document drop-off and review', 'Entrega y revisión de documentos'), minutes: 20, fee: 0, prepay: false, mode: 'office', active: true },
    { name: l('Working session', 'Sesión de trabajo'), minutes: 60, fee: 0, prepay: false, mode: 'office', buffer: 10, active: true },
  ],
  // the shipped automations of this edition: the coded rules it shares with the field editions plus its own, written as data (rules.ts)
  rules: practiceRules.map((r) => ({ ...r, when: { ...r.when } })),
  usesWorkers: false,
};
