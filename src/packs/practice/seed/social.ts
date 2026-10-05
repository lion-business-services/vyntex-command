// Sample social posts of the fictional firm: a draft that one network would refuse as it stands, one waiting for approval,
// two on the calendar, one that was "published" in the sample and one that shows what a failed post looks like.
// No account is connected in a sample workspace, so nothing here was ever posted anywhere: `demo` means marked as published
// in the sample, and the failed one says in its own text that it is a sample record.
import type { Lang, SeedData, SocialPost } from '@/domain/types';
import { at } from '@/lib/dates';
import { stamp, txFor } from './util';

export function social(lang: Lang): Partial<SeedData> {
  const tx = txFor(lang);
  const posts: SocialPost[] = [
    // Instagram does not take a post without a picture: the preview says so
    { id: 'sp1', status: 'draft', by: 'u3', created: stamp(-1, 15, 20), channels: ['facebook', 'instagram'],
      text: tx('Saturday hours start this week at the main office: 9 to 1. Walk-ins are welcome.', 'Esta semana empieza el horario de sábado en la oficina principal: de 9 a 1. Puede venir sin cita.') },
    { id: 'sp2', status: 'needs_approval', by: 'u3', created: stamp(-2, 11, 5), channels: ['facebook', 'gbp'],
      text: tx('Business owners: the quarter is closing. If you want help getting your numbers together, call the office and we will set a time.', 'Dueños de negocio: el trimestre está por cerrar. Si quiere ayuda para ordenar sus números, llame a la oficina y agendamos una hora.') },
    { id: 'sp3', status: 'scheduled', by: 'u2', approvedBy: 'u1', created: stamp(-3, 10, 0), scheduledFor: at(2, 10, 0), channels: ['facebook', 'gbp'],
      text: tx('New to payroll? We set it up and run it for you every pay period. Ask for a first consultation.', '¿Es nuevo con la nómina? La configuramos y la corremos por usted en cada periodo de pago. Pida una primera consulta.') },
    { id: 'sp4', status: 'scheduled', by: 'u1', approvedBy: 'u1', created: stamp(-1, 9, 40), scheduledFor: at(6, 9, 30), channels: ['gbp'],
      text: tx('The east office will be closed next Monday. The main office is open as usual.', 'La oficina este estará cerrada el próximo lunes. La oficina principal atiende como siempre.') },
    { id: 'sp5', status: 'demo', by: 'u1', approvedBy: 'u1', created: stamp(-6, 9, 0), publishedAt: stamp(-5, 10, 0), channels: ['facebook', 'gbp'],
      text: tx('We speak English, Spanish and Chinese. Tell us which one you prefer when you call.', 'Atendemos en inglés, español y chino. Díganos cuál prefiere cuando llame.') },
    { id: 'sp6', status: 'failed', by: 'u2', approvedBy: 'u1', created: stamp(-9, 14, 0), scheduledFor: stamp(-8, 9, 0), channels: ['gbp'],
      error: tx('Sample record: this is how a post the network refused looks. Nothing was posted.', 'Registro de muestra: así se ve una publicación que la red rechazó. No se publicó nada.'),
      text: tx('Thank you to everyone who came by this season.', 'Gracias a todos los que nos visitaron esta temporada.') },
  ];
  return { posts };
}
