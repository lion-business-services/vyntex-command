// Shared by the public pages: the page title.
import { useEffect } from 'react';
import { DEPLOY } from '@/config/deployment';

export function useTitle(title: string) { useEffect(() => { document.title = `${title} · ${DEPLOY.productName}`; }, [title]); }
