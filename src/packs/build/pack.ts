// VYNTEX BUILD: industry pack for construction.
// Everything industry-specific lives here. The app core never checks the industry id.
import type { IndustryPack } from '../types';
import { seed } from './seed';

export const buildPack: IndustryPack = {
  id: "build",
  product: "VYNTEX BUILD",
  label: { en: "Construction", es: "Construcción" },
  blurb: { en: "For remodelers, builders and general contractors.", es: "Para remodeladores, constructores y contratistas generales." },
  ticketPrefix: "VB-",
  recurring: false,
  sampleCompany: { name: "Sample Builders LLC", initials: "SB", license: "NJ HIC #__________", phone: "609-555-0100", email: "samplebuilders@example.com" },
  serviceTypes: [
    { id: "kitchen", en: "Kitchen", es: "Cocina" },
    { id: "bathroom", en: "Bathroom", es: "Baño" },
    { id: "addition", en: "Addition", es: "Ampliación" },
    { id: "deck", en: "Deck & outdoor", es: "Deck y exteriores" },
    { id: "pergola", en: "Pergola", es: "Pérgola" },
    { id: "windows", en: "Windows & doors", es: "Ventanas y puertas" },
    { id: "flooring", en: "Flooring", es: "Pisos" },
    { id: "remodel", en: "General remodeling", es: "Remodelación general" },
    { id: "commercial", en: "Commercial", es: "Comercial" },
    { id: "other", en: "Other", es: "Otro" },
  ],
  terms: {
    en: {
      "owner": "Owner",
      "industry": "Industry",
      "thanks": "Thank you for choosing {company}."
    },
    es: {
      "owner": "Dueño",
      "industry": "Industria",
      "thanks": "Gracias por elegir a {company}."
    },
  },
  jobStatuses: ['estimate', 'contract', 'progress', 'hold', 'done'],
  kpis: ["activeJobs","activeValue","expectedProfit","clientsOwe","oweWorkers","newLeads"],
  agreement: {
    en: {
      "title": "Home Improvement Contract",
      "intro": "This contract is between {company} (\"Contractor\") and the client named below (\"Client\").",
      "s1": "1. Scope of work",
      "s2": "2. Price and payments",
      "total": "Total contract price",
      "s3": "3. Schedule",
      "sched": "Estimated start: {start}. Estimated completion: {end}. Dates may change because of weather, material delays or changes requested by the Client.",
      "s4": "4. Changes",
      "chg": "Any change to the work or the price must be agreed in a written change order signed by both parties before that work is done.",
      "s5": "5. Insurance",
      "ins": "Contractor carries commercial general liability insurance. Insurer: ____________________ Phone: ____________________",
      "s6": "6. Your right to cancel",
      "cxl": "You, the Client, may cancel this contract at any time before midnight of the third business day after you receive a signed copy of it. Your notice of cancellation must be in writing and delivered or emailed to the Contractor at the address above.",
      "s7": "7. Electronic signatures",
      "esig": "The parties agree that this contract and any change orders may be signed electronically. An electronic signature has the same legal effect as a handwritten signature under the federal ESIGN Act (15 U.S.C. § 7001 et seq.) and the New Jersey Uniform Electronic Transactions Act (N.J.S.A. 12A:12-1 et seq.). The Client consents to receive this contract and related notices electronically.",
      "draft": "Draft template. Have a New Jersey attorney review the final wording before using it with clients."
    },
    es: {
      "title": "Contrato de Mejoras al Hogar",
      "intro": "Este contrato es entre {company} (\"el Contratista\") y el cliente nombrado abajo (\"el Cliente\").",
      "s1": "1. Alcance del trabajo",
      "s2": "2. Precio y pagos",
      "total": "Precio total del contrato",
      "s3": "3. Calendario",
      "sched": "Inicio estimado: {start}. Terminación estimada: {end}. Las fechas pueden cambiar por el clima, retrasos de materiales o cambios pedidos por el Cliente.",
      "s4": "4. Cambios",
      "chg": "Cualquier cambio en el trabajo o en el precio debe acordarse en una orden de cambio por escrito, firmada por ambas partes antes de hacer ese trabajo.",
      "s5": "5. Seguro",
      "ins": "El Contratista tiene seguro de responsabilidad civil general. Aseguradora: ____________________ Teléfono: ____________________",
      "s6": "6. Su derecho a cancelar",
      "cxl": "Usted, el Cliente, puede cancelar este contrato en cualquier momento antes de la medianoche del tercer día hábil después de recibir una copia firmada. El aviso de cancelación debe ser por escrito y entregarse o enviarse por correo electrónico al Contratista a la dirección indicada arriba.",
      "s7": "7. Firmas electrónicas",
      "esig": "Las partes acuerdan que este contrato y cualquier orden de cambio pueden firmarse electrónicamente. Una firma electrónica tiene el mismo efecto legal que una firma a mano bajo la ley federal ESIGN (15 U.S.C. § 7001 y siguientes) y la Ley Uniforme de Transacciones Electrónicas de Nueva Jersey (N.J.S.A. 12A:12-1 y siguientes). El Cliente acepta recibir este contrato y los avisos relacionados de forma electrónica.",
      "draft": "Plantilla en borrador. Un abogado de Nueva Jersey debe revisar el texto final antes de usarlo con clientes."
    },
  },
  kickoffTasks: [
    { en: "Send the contract for signature", es: "Enviar el contrato para firma", dueIn: 0, for: 'owner', pri: 'high' },
    { en: "Collect the deposit", es: "Cobrar el depósito", dueIn: 2, for: 'owner', pri: 'high' },
    { en: "Apply for the permit or confirm that none is needed", es: "Solicitar el permiso o confirmar que no hace falta", dueIn: 3, for: 'owner' },
    { en: "Order long lead materials (cabinets, windows, tile)", es: "Pedir los materiales con entrega larga (gabinetes, ventanas, azulejo)", dueIn: 5, for: 'owner' },
    { en: "Confirm the start date and house rules with the client (dumpster, parking, pets)", es: "Confirmar con el cliente la fecha de inicio y las reglas de la casa (contenedor, estacionamiento, mascotas)", dueIn: 7, for: 'owner' },
  ],
  closeoutTasks: [
    { en: "Final walkthrough and punch list with the client", es: "Recorrido final y lista de pendientes con el cliente", dueIn: 0, for: 'owner', pri: 'high' },
    { en: "Send the final invoice", es: "Enviar la factura final", dueIn: 1, for: 'owner', pri: 'high' },
    { en: "Collect lien waivers from the subcontractors", es: "Reunir las renuncias de gravamen de los subcontratistas", dueIn: 3, for: 'owner' },
    { en: "Send the warranty letter and ask for a review", es: "Enviar la carta de garantía y pedir una reseña", dueIn: 7, for: 'owner', pri: 'low' },
  ],
  compliance: true,
  seed,
};
