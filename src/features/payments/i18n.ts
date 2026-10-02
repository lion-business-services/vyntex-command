import type { Dict } from '@/i18n';

export const dict: Dict = {
  en: {
    'payments.sub': 'Money in and money out, recorded here by hand as it happens: cash, check, bank transfer, Zelle or card.',
    'payments.k.received': 'Received this month', 'payments.k.clientsOwe': '{Clients} owe you', 'payments.k.clientsOweHint': 'Work in progress and completed work',
    'payments.k.paid': 'Paid to {workers} this month', 'payments.k.owed': 'Still owed to {workers}',
    'payments.tab.received': 'Received from {clients}', 'payments.tab.workers': 'Paid to {workers}', 'payments.tab.expenses': 'Expenses', 'payments.tab.balances': 'Balances',
    'payments.allMethods': 'All methods', 'payments.csv': 'Download CSV', 'payments.csvDone': 'File downloaded',
    'payments.col.client': '{Client}', 'payments.col.vendor': 'Store or vendor', 'payments.col.what': 'What was bought', 'payments.col.received': 'Received',
    'payments.empty.received': 'No payments received yet', 'payments.empty.receivedHint': 'Record one each time a {client} pays you.',
    'payments.empty.workers': 'No payments to {workers} yet', 'payments.empty.workersHint': 'Record one each time you pay someone. One payment can be split across several {jobs}.',
    'payments.empty.expenses': 'No expenses recorded yet', 'payments.empty.expensesHint': 'Materials and other purchases are added from the page of each {job}.',
    'payments.bal.clients': '{Clients} who still owe', 'payments.bal.noClients': 'Nobody owes you anything right now.', 'payments.bal.noWorkers': 'Nothing is owed to {workers} right now.',
    'payments.file.received': 'payments-received', 'payments.file.workers': 'payments-made', 'payments.file.expenses': 'expenses', 'payments.file.balances': 'balances',
  },
  es: {
    'payments.sub': 'El dinero que entra y el que sale, registrado aquí a mano conforme ocurre: efectivo, cheque, transferencia, Zelle o tarjeta.',
    'payments.k.received': 'Recibido este mes', 'payments.k.clientsOwe': 'Le deben los {clients}', 'payments.k.clientsOweHint': 'Trabajo en curso y trabajo ya completado',
    'payments.k.paid': 'Pagado a {workers} este mes', 'payments.k.owed': 'Por pagar a {workers}',
    'payments.tab.received': 'Recibido de {clients}', 'payments.tab.workers': 'Pagado a {workers}', 'payments.tab.expenses': 'Gastos', 'payments.tab.balances': 'Saldos',
    'payments.allMethods': 'Todos los métodos', 'payments.csv': 'Descargar CSV', 'payments.csvDone': 'Archivo descargado',
    'payments.col.client': '{Client}', 'payments.col.vendor': 'Tienda o proveedor', 'payments.col.what': 'Qué se compró', 'payments.col.received': 'Recibido',
    'payments.empty.received': 'Aún no hay pagos recibidos', 'payments.empty.receivedHint': 'Registre uno cada vez que le paguen.',
    'payments.empty.workers': 'Aún no hay pagos a {workers}', 'payments.empty.workersHint': 'Registre uno cada vez que le pague a alguien. Un mismo pago se puede dividir si cubre más de un trabajo.',
    'payments.empty.expenses': 'Aún no hay gastos registrados', 'payments.empty.expensesHint': 'Los materiales y otras compras se agregan desde la página de cada {job}.',
    'payments.bal.clients': '{Clients} con saldo pendiente', 'payments.bal.noClients': 'Nadie le debe nada en este momento.', 'payments.bal.noWorkers': 'No hay nada por pagar a {workers} en este momento.',
    'payments.file.received': 'pagos-recibidos', 'payments.file.workers': 'pagos-hechos', 'payments.file.expenses': 'gastos', 'payments.file.balances': 'saldos',
  },
};
