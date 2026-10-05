// Sample appointments of the sample firm: every status, across the past month and the next two weeks, for sample clients
// and leads. Two credits show the ledger: one still usable, one already spent on a later appointment.
// The appointment types are the edition's starter set (ids at1 to at5, the same ids a new company gets) plus one type the
// sample firm added for itself, with a fictional fee paid in advance. Nothing here is a real price or a real person.
import type { Appointment, AppointmentType, Credit, Lang } from '@/domain/types';
import { practicePack } from '../pack';
import { day, stamp, txFor } from './util';

const dow = (off: number) => { const d = new Date(); d.setDate(d.getDate() + off); return d.getDay(); };
/** Monday to Friday. */
const open = (off: number) => dow(off) !== 0 && dow(off) !== 6;
/** Day offset of the nth working day from today (0 = today, or the next Monday on a weekend). Negative counts back. */
function workday(n: number): number {
  let off = 0;
  while (!open(off)) off++;
  for (let left = Math.abs(n); left > 0;) { off += n > 0 ? 1 : -1; if (open(off)) left--; }
  return off;
}
/** A timestamp for a moment that may be ahead of now (a pay-by time): date offset and hour, on the office clock. */
function moment(off: number, hour: number, minute = 0): string { const d = new Date(); d.setDate(d.getDate() + off); d.setHours(hour, minute, 0, 0); return d.toISOString(); }

const OFFICE: Record<string, string> = { o1: '100 Sample Avenue, Suite 2, Northfield, NJ 08225', o2: '20 Sample Street, Vineland, NJ 08360' };

export function appointments(lang: Lang): { apptTypes: AppointmentType[]; appointments: Appointment[]; credits: Credit[] } {
  const tx = txFor(lang);
  const apptTypes: AppointmentType[] = [
    ...practicePack.appointmentTypes.map((a, i) => ({ ...a, name: { ...a.name }, id: 'at' + (i + 1) })),
    // the sample firm's own type: a fictional fee, paid before the slot is confirmed
    { id: 'at6', name: { en: 'Tax planning session', es: 'Sesión de planeación fiscal' }, minutes: 45, fee: 75, prepay: true, mode: 'video', buffer: 15, active: true },
  ];
  const type = (id: string) => apptTypes.find((x) => x.id === id) as AppointmentType;
  // [hour, minute] on a day offset; who booked it and when
  const appt = (id: string, typeId: string, off: number, h: number, mi: number, o: Pick<Appointment, 'staffId' | 'status'> & Partial<Appointment>, bookedDaysBefore = 6): Appointment => {
    const t = type(typeId); const officeId = o.officeId ?? 'o1';
    return {
      id, typeId, date: day(off), time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, minutes: t.minutes, mode: t.mode, fee: t.fee,
      officeId, location: t.mode === 'office' ? OFFICE[officeId] : undefined, created: stamp(off - bookedDaysBefore, 11, 20), createdBy: o.staffId, ...o,
    };
  };
  // the next working day that is at least two days out, so its pay-by moment (24 hours before) is close but not here yet
  let soon = 2; while (!open(soon)) soon++;
  const w = workday;
  const backMonday = (((8 - dow(0)) % 7) || 7) + 7;

  const list: Appointment[] = [
    // ---- today and the next two weeks
    appt('pa1', 'at4', w(0), 11, 30, { clientId: 'pc1', staffId: 'u3', status: 'confirmed', jobId: 'pe4', notes: tx('Picking up her copies and dropping off the property tax bill.', 'Recoge sus copias y deja el recibo del impuesto predial.') }, 3),
    appt('pa2', 'at2', w(0), 16, 0, { clientId: 'pc2', staffId: 'u2', status: 'scheduled', jobId: 'pe5', notes: tx('Call about the balance on his return. His daughter Joan may join.', 'Llamada por el saldo de su declaración. Puede que se una su hija Joan.') }, 2),
    // the lead's own appointment date points at this one
    appt('pa3', 'at1', 2, 10, 30, { leadId: 'pl5', staffId: 'u3', status: 'scheduled', notes: tx('First consultation about payroll for three stylists.', 'Primera consulta sobre la nómina de tres estilistas.') }, 3),
    // waiting for payment: the slot is released if it is not paid by the day before
    appt('pa4', 'at6', soon, 14, 0, { clientId: 'pc7', staffId: 'u2', status: 'awaiting_payment', payBy: moment(soon - 1, 14), jobId: 'pe3', created: stamp(-1, 16, 40), notes: tx('Estimated payments for next year and the new truck.', 'Pagos estimados del próximo año y la camioneta nueva.') }, 1),
    appt('pa5', 'at3', w(3), 11, 0, { clientId: 'pc8', staffId: 'u2', status: 'confirmed', jobId: 'pe9', notes: tx('Go over the proposal for the second company.', 'Revisar la propuesta para la segunda empresa.') }),
    appt('pa6', 'at5', w(4), 9, 0, { clientId: 'pc6', staffId: 'u3', status: 'scheduled', jobId: 'pe1', notes: tx('Month-end questions and the new card account.', 'Dudas del cierre de mes y la nueva cuenta de tarjeta.') }),
    // paid with the credit from the session the office had to cancel (pa13)
    appt('pa7', 'at6', w(6), 10, 0, { clientId: 'pc5', staffId: 'u3', status: 'confirmed', creditId: 'pcr1', paid: { at: stamp(w(-7), 15, 10), method: 'credit', ref: 'pcr1', amount: 75 }, jobId: 'pe6', created: stamp(w(-7), 15, 0) }),
    // a request that came in and nobody has accepted yet: it holds no time on the calendar
    appt('pa8', 'at3', w(7), 13, 0, { clientId: 'pc10', staffId: 'u1', status: 'requested', officeId: undefined, createdBy: 'system', notes: tx('Asked for a video call about the annual report.', 'Pidió una videollamada sobre el informe anual.') }, 8),
    // with the associate who is out next week (seed/people.ts): booked for the Monday she is back
    appt('pa9', 'at1', backMonday, 10, 0, { clientId: 'pc9', staffId: 'u4', status: 'scheduled', officeId: 'o2', jobId: 'pe7' }),
    // moved once: the client asked for a later day; pa10b is the record of the earlier slot
    appt('pa10', 'at5', w(9), 9, 30, { clientId: 'pc7', staffId: 'u2', status: 'scheduled', jobId: 'pe3', rescheduledFrom: 'pa10b', created: stamp(w(-2), 10, 5) }),
    appt('pa10b', 'at5', w(5), 9, 30, { clientId: 'pc7', staffId: 'u2', status: 'cancelled_client', jobId: 'pe3', created: stamp(w(-2), 10, 5), cancelReason: tx('Asked to move it: the December statement will not arrive in time.', 'Pidió moverla: el estado de cuenta de diciembre no llega a tiempo.') }),

    // ---- the past month
    appt('pa11', 'at1', w(-21), 10, 0, { clientId: 'pc5', staffId: 'u3', status: 'completed', jobId: 'pe6' }),
    appt('pa12', 'at5', w(-15), 9, 0, { clientId: 'pc6', staffId: 'u3', status: 'completed', jobId: 'pe1' }),
    // the office cancelled a paid session: the client got a credit, and spent it on pa7
    appt('pa13', 'at6', w(-8), 10, 0, { clientId: 'pc5', staffId: 'u3', status: 'cancelled_staff', paid: { at: stamp(w(-11), 12, 40), method: 'cash', ref: '', amount: 75 }, payBy: moment(w(-8) - 1, 10),
      created: stamp(w(-12), 11, 20), cancelReason: tx('The associate was out sick that day.', 'La asociada estuvo enferma ese día.') }),
    appt('pa14', 'at1', w(-13), 11, 0, { leadId: 'pl6', staffId: 'u4', status: 'completed', officeId: 'o2', notes: tx('Went over what the market needs filed each quarter.', 'Se revisó lo que el mercado debe presentar cada trimestre.') }),
    appt('pa15', 'at6', w(-12), 11, 0, { clientId: 'pc8', staffId: 'u2', status: 'completed', paid: { at: stamp(w(-14), 9, 50), method: 'check', ref: '3310', amount: 75 }, payBy: moment(w(-12) - 1, 11) }),
    appt('pa16', 'at6', w(-7), 14, 0, { clientId: 'pc4', staffId: 'u4', status: 'cancelled_unpaid', officeId: 'o2', payBy: moment(w(-7) - 1, 14) }, 4),
    appt('pa17', 'at1', w(-6), 10, 0, { clientId: 'pc3', staffId: 'u4', status: 'no_show', officeId: 'o2' }, 5),
    // the office cancelled a paid session: this credit is still usable
    appt('pa18', 'at6', w(-4), 15, 0, { clientId: 'pc2', staffId: 'u2', status: 'cancelled_staff', paid: { at: stamp(w(-6), 16, 5), method: 'zelle', ref: 'ZL-2207', amount: 75 }, payBy: moment(w(-4) - 1, 15),
      cancelReason: tx('The office closed early for staff training.', 'La oficina cerró temprano por capacitación del equipo.') }, 4),
    appt('pa19', 'at2', w(-3), 9, 0, { clientId: 'pc6', staffId: 'u3', status: 'cancelled_client', cancelReason: tx('A delivery came early; she will call to set another time.', 'Llegó una entrega antes de tiempo; llamará para fijar otra hora.') }, 4),
    appt('pa20', 'at4', w(-18), 15, 0, { clientId: 'pc1', staffId: 'u3', status: 'completed', jobId: 'pe4' }),
  ];
  const credits: Credit[] = [
    { id: 'pcr2', clientId: 'pc2', amount: 75, reason: 'cancel_staff', fromApptId: 'pa18', at: stamp(w(-4), 9, 15), by: 'u2' },
    { id: 'pcr1', clientId: 'pc5', amount: 75, reason: 'cancel_staff', fromApptId: 'pa13', at: stamp(w(-8), 8, 45), by: 'u3', used: { apptId: 'pa7', at: stamp(w(-7), 15, 10) } },
  ];
  return { apptTypes, appointments: list, credits };
}
