// Settings wording of LBS Command. The shared wording of this folder speaks to a prospect trying the public demo ("on this
// demo", "when you become a customer"); none of that fits a firm's own workspace. The accent colour is not offered here
// at all (the brand's gold is fixed), so nothing about colours is worded. This file
// replaces those lines, key for key, and is registered only in the LBS build (src/i18n/features.ts). Chinese falls back to
// English. scripts/check-i18n.mjs checks that every key here exists in the shared wording and in both languages.
// The workspace lines that say "demo" in the shared wording and "sample" here (src/i18n/lbs.ts) travel with this file, so
// the one registration and the one check cover both.
import type { Dict } from '@/i18n';
import { lbsWorkspace } from '@/i18n/lbs';

export const dict: Dict = {
  en: {
    ...lbsWorkspace.en,
    'settings.sub': 'Your business details, your team and how the workspace is set up.',
    'settings.biz.title': 'Your business',
    'settings.biz.local': 'These changes stay in this browser only. "Reset sample" puts the sample records back, including the name and logo.',
    'settings.team.rolesIntro': 'Each person sees only what their role includes.',
    'settings.look.langHint': 'The whole workspace changes language.',
    'settings.data.intro': 'Everything in this sample preview for {company}.',
    'settings.data.downloadText': 'One file with every lead, {client}, {job}, task, payment, document and message in this sample preview.',
    'settings.data.download': 'Download the sample records',
    'settings.data.resetText': 'Puts the sample records back the way they were, including the name and logo. What you changed here is removed.',
    'settings.data.where': 'In this sample preview, everything you see and change is kept only in this browser, on this device, and clearing the browser data erases it. No client data is loaded here. The live workspace keeps its records in its own private database: only the people who are invited can sign in, and each one sees only what their role allows.',
  },
  es: {
    ...lbsWorkspace.es,
    'settings.sub': 'Los datos de su negocio, su equipo y cómo está configurado el espacio de trabajo.',
    'settings.biz.title': 'Su negocio',
    'settings.biz.local': 'Estos cambios se quedan solo en este navegador. "Reiniciar muestra" devuelve los registros de muestra, con el nombre y el logo.',
    'settings.team.rolesIntro': 'Cada persona ve solo lo que incluye su rol.',
    'settings.look.langHint': 'Todo el espacio de trabajo cambia de idioma.',
    'settings.data.intro': 'Todo lo que hay en esta vista de muestra de {company}.',
    'settings.data.downloadText': 'Un archivo con cada prospecto, {client}, {job}, tarea, pago, documento y mensaje de esta vista de muestra.',
    'settings.data.download': 'Descargar los registros de muestra',
    'settings.data.resetText': 'Devuelve los registros de muestra a como estaban, con el nombre y el logo. Se quita lo que usted cambió aquí.',
    'settings.data.where': 'En esta vista de muestra, todo lo que ve y cambia se guarda solo en este navegador, en este dispositivo, y si borra los datos del navegador se pierde. Aquí no hay datos de clientes cargados. El espacio de trabajo real guarda sus registros en su propia base de datos privada: solo pueden entrar las personas invitadas, y cada una ve solo lo que su rol permite.',
  },
};
