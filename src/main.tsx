import '@/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { installPreviewGuards } from '@/app/preview';

installPreviewGuards();

createRoot(document.getElementById('root')!).render(<App />);
