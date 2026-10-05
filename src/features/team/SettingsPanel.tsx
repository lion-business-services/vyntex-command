// Settings section: offices and who works where. The same card as the Offices part of the security center.
// Registered in src/features/settings/panels.ts.
import { OfficesCard } from '@/features/security/offices';
import { StepUpHost } from '@/features/security/stepup';
import '@/features/security/security.css';

export default function OfficesSettingsPanel() {
  return <><OfficesCard /><StepUpHost /></>;
}
