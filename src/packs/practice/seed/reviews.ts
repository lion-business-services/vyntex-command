// Sample review requests of the fictional firm: three requests in different states, two of them answered.
// Nothing here is a real client or a real opinion; the screen labels the whole workspace as sample records.
// A fourth request is not typed in: the shipped rule "Review request after completed work" prepares it as a draft for the
// engagement completed most recently (see primeDemo), and the low rating below gets its follow-up task the same way.
// Ids rv1 to rv3 and the engagements they point at (pe4, pe11, pe14) are fixed.
import type { ISODate, ISODateTime, Lang, ReviewRequest, SeedData } from '@/domain/types';
import { day, stamp, txFor } from './util';

/** The same extra fields the reviews module keeps (src/domain/actions/reviews.ts): the private link's key and its dates. */
type SampleReview = ReviewRequest & { token: string; expires: ISODate; openedAt?: ISODateTime; answeredAt?: ISODateTime };

export function reviews(lang: Lang): Partial<SeedData> {
  const tx = txFor(lang);
  const list: SampleReview[] = [
    // opened four days ago, not answered yet
    { id: 'rv3', clientId: 'pc9', jobId: 'pe14', at: stamp(-6, 11), channel: 'email', status: 'opened', by: 'u4', token: 'sample-rv3', expires: day(24), openedAt: stamp(-4, 19) },
    // a middling answer: the senior associate gets a task to call
    { id: 'rv2', clientId: 'pc6', jobId: 'pe11', at: stamp(-24, 10), channel: 'email', status: 'rated', by: 'u3', token: 'sample-rv2', expires: day(6), openedAt: stamp(-23, 8), answeredAt: stamp(-23, 8, 10), rating: 3,
      comment: tx('The numbers were right, but the monthly summary reached us late two months in a row.', 'Los números estaban bien, pero el resumen mensual nos llegó tarde dos meses seguidos.') },
    { id: 'rv1', clientId: 'pc1', jobId: 'pe4', at: stamp(-33, 15), channel: 'email', status: 'rated', by: 'u3', token: 'sample-rv1', expires: day(-3), openedAt: stamp(-31, 12), answeredAt: stamp(-31, 12, 5), rating: 5,
      comment: tx('Quick and clear. Every line of the return was explained to me in Spanish.', 'Rápido y claro. Me explicaron en español cada línea de la declaración.') },
  ];
  return { reviews: list };
}
