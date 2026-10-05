// Shapes the signature module needs on top of src/domain/types.ts. The extra fields are optional and travel with the
// record (the database keeps fields it has no column for in `extra`), so nothing here changes the shared data model.
// No browser code in this folder: the same files run in the app, in the unit tests and on the server.
import type { DocVersion, Envelope, FileRef, ISODateTime, L10n, Lang, Signer } from '../types';

/** Who a signer is to the document. Free text is allowed too; these four have a label in every language. */
export type SignerRole = 'client' | 'co_owner' | 'spouse' | 'firm';
export const SIGNER_ROLES: SignerRole[] = ['client', 'co_owner', 'spouse', 'firm'];

export interface SignerX extends Signer {
  sentAt?: ISODateTime;
  declinedAt?: ISODateTime;
  declineReason?: string;
  /** When the signer ticked the consent box. The sentence they agreed to is `consentText` on the envelope. */
  consentAt?: ISODateTime;
  /** Drawn or typed initials, an image (PNG data address). */
  initials?: string;
  lastReminder?: ISODateTime;
  /** TeamUser id when the signer is someone of the company. */
  userId?: string;
}

/** Size of a page in PDF points (72 per inch), as it is displayed. */
export interface PageSize { w: number; h: number }

export type RGB = [number, number, number];
export type FontId = 'regular' | 'bold' | 'italic';
/**
 * One thing drawn on a page. Coordinates are PDF points from the bottom-left corner, the way a PDF counts them.
 * A page is a list of these, so the PDF writer and the on-screen page draw exactly the same thing.
 */
export type DrawOp =
  | { t: 'text'; x: number; y: number; s: string; f: FontId; size: number; c: RGB }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; c: RGB }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: RGB; stroke?: RGB; sw?: number }
  | { t: 'img'; x: number; y: number; w: number; h: number; key: string };
export interface PageView extends PageSize { ops: DrawOp[] }

/** The three fingerprints of a signed document, SHA-256 in hex. */
export interface EnvelopeHashes {
  /** The PDF exactly as it was sent out. */
  original: string;
  /** The pages with every field filled in, before the certificate page was added. This is the one printed on the certificate. */
  signed?: string;
  /** The finished file, certificate included. A file cannot contain its own fingerprint, so this one is kept on the record. */
  final?: string;
}

export interface EnvelopeX extends Envelope {
  signers: SignerX[];
  /** Language of the signing page and of the certificate. */
  lang?: Lang;
  /** Note from the sender, shown to every signer. */
  message?: string;
  clientId?: string;
  jobId?: string;
  leadId?: string;
  /** The PDF exactly as it was sent. Nothing is ever stamped into this file: the signed copy is a new one. */
  source?: FileRef;
  pages?: PageSize[];
  /** Drawing of each page of a generated document, so a signer sees precisely what was sent. Uploaded PDFs have none. */
  view?: PageView[];
  /** Images the drawing refers to (the company logo), by key. */
  images?: Record<string, string>;
  hashes?: EnvelopeHashes;
  /** The consent sentence each signer was shown, frozen when the envelope was sent. */
  consentText?: string;
  voidReason?: string;
  /** Days the request stays open once it is sent. */
  expiryDays?: number;
  /** Document number and kind label at the time of sending, for the certificate. */
  docNumber?: string;
  docKind?: string;
}

/** A made-up file of a sample business: the lines of text of its one page stand in for the bytes, which a record never holds. */
export type SampleFileRef = FileRef & { sample?: string[] };

/** A version of a generated document also remembers the text edits it replaced, so an older text can be brought back. */
export interface DocVersionX extends DocVersion { edits?: Record<string, string>; kind?: 'upload' | 'edit' | 'signed' }

/** The company's signature settings, kept under `settings.esign`. */
export interface EsignSettings {
  /** The sentence a signer agrees to before signing. Empty until the company writes its own. */
  consent?: Partial<L10n>;
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: ISODateTime;
  /** Days until a request expires. */
  expiryDays?: number;
  /** Days between reminders; 0 switches them off. */
  remindEvery?: number;
}

/** What one signer is shown and may do. Built by `signerView()`; the public signing address returns exactly this. */
export interface SignerView {
  envelopeId: string;
  signerId: string;
  title: string;
  company: string;
  lang: Lang;
  /** `open`: sign now. `waiting`: someone else signs first. The rest are final for this signer. */
  state: 'open' | 'waiting' | 'signed' | 'completed' | 'declined' | 'expired' | 'void';
  signer: { name: string; email: string; role?: string };
  /** Everyone on the request, without their email addresses. */
  people: { name: string; role?: string; status: Signer['status']; me: boolean }[];
  ordered: boolean;
  message?: string;
  consentText: string;
  pages: PageSize[];
  view?: PageView[];
  images?: Record<string, string>;
  /** Address of the PDF for the browser's own viewer, when there is no drawing. */
  fileUrl?: string;
  /** The signer's own boxes, in the order to fill them, and the boxes others already filled (read only). */
  fields: (Envelope['fields'][number] & { mine: boolean; color: number; /** Signature or initials already on the page, as an image. */ ink?: string; /** The signer's name, written in the box when there is no image. */ inkName?: string })[];
  expiresAt?: ISODateTime;
  demo: boolean;
}

/** What a signer sends back. */
export interface SignPayload {
  consent: boolean;
  typedName: string;
  /** PNG data address of the drawn or typed signature. */
  signature: string;
  initials?: string;
  /** Field id -> value, for date, text and checkbox boxes. */
  values: Record<string, string>;
}
