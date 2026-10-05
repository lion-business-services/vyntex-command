// Wording of the licensing screen, English and Spanish (Chinese optional). Prefix every key with `licensing.`.
import type { Dict } from '@/i18n';

export const dict: Dict = {
  en: {
    'licensing.sub': 'Licenses and registrations the firm keeps track of, for itself and for its {clients}, with the date each one must be renewed.',
    'licensing.today': 'The list of licenses and registrations on this screen works today: each one is a dated record with reminders and the document that proves it. The firm\'s separate licensing tool was not supplied for this build, so its history is not here.',
    'licensing.staffApp': 'Licensing application for the staff',
    'licensing.list': 'Licenses and registrations', 'licensing.new': 'Add license or registration', 'licensing.addFor': 'Add another', 'licensing.scope.open': 'Current',
    'licensing.empty': 'No license or registration on record', 'licensing.noneOpen': 'Nothing is current. Choose All to see the history.',
    'licensing.emptyHint': 'Add each one with the date it must be renewed, and attach the document when it is renewed.',
    'licensing.note': 'Every renewal date here was entered by a person at the firm. A license also shows on the Deadlines screen and in the reminders.',
    'licensing.need.source': 'The source code of the licensing tracker the firm uses today.',
    'licensing.need.records': 'The licenses and registrations on file today, with their dates and documents, to move over.',
    'licensing.need.types': 'The kinds of license the firm handles and what each one asks for, written by the firm.',
    'licensing.need.signoff': 'A person at the firm who checks the list that was moved against the originals.',
    'licensing.never': 'No agency rule, fee or renewal period is built in. The firm enters every date.',
  },
  es: {
    'licensing.sub': 'Las licencias y registros que el despacho vigila, propios y de sus {clients}, con la fecha en que cada uno debe renovarse.',
    'licensing.today': 'La lista de licencias y registros de esta pantalla ya funciona: cada uno es un registro con fecha, recordatorios y el documento que lo comprueba. La herramienta de licencias propia del despacho no se entregó para esta versión, así que su historial no está aquí.',
    'licensing.staffApp': 'Aplicación de licencias para el equipo',
    'licensing.list': 'Licencias y registros', 'licensing.new': 'Agregar licencia o registro', 'licensing.addFor': 'Agregar otro', 'licensing.scope.open': 'Vigentes',
    'licensing.empty': 'No hay licencias ni registros capturados', 'licensing.noneOpen': 'No hay nada vigente. Elija Todos para ver el historial.',
    'licensing.emptyHint': 'Agregue cada uno con la fecha en que debe renovarse y adjunte el documento cuando se renueve.',
    'licensing.note': 'Cada fecha de renovación la capturó una persona del despacho. Una licencia también aparece en la pantalla de Vencimientos y en los recordatorios.',
    'licensing.need.source': 'El código fuente del control de licencias que el despacho usa hoy.',
    'licensing.need.records': 'Las licencias y registros que hay hoy en archivo, con sus fechas y documentos, para pasarlos.',
    'licensing.need.types': 'Los tipos de licencia que maneja el despacho y lo que pide cada uno, escrito por el despacho.',
    'licensing.need.signoff': 'Una persona del despacho que compare la lista que se pasó contra los originales.',
    'licensing.never': 'No viene incluida ninguna regla, cuota ni plazo de renovación de ninguna agencia. El despacho captura cada fecha.',
  },
};
