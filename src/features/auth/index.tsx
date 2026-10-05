// Sign-in pages and the live-session pieces of the workspace.
//   SignIn          `/signin`, the home page of a deployment without sales pages, and `/mfa`
//   LiveGate        any live workspace address while the workspace is not open: it opens it, or shows the step that is due
//   Invite          `/invite/<token>`           ResetPassword   `/reset-password` (the emailed link carries `#token=`)
//   LiveChrome      saved/saving indicator, account menu and the identity check prompt, mounted beside a live workspace
// The routes are in src/app/App.tsx.
import { AuthFlow } from './flow';

/** The sign-in page. Signed in already: straight on to the person's company. */
export function SignIn() { return <AuthFlow />; }
/** `/mfa`: the second sign-in step is part of the same walk, so this address shows whichever step is due. */
export const Mfa = SignIn;
/**
 * A company address (`/<slug>`, or `/app`) for which no workspace is open. A person who is signed in and belongs to it gets
 * the workspace; anyone else gets the sign-in page, whether or not such a company exists.
 */
export function LiveGate({ slug }: { slug: string }) { return <AuthFlow slug={slug} key={slug} />; }

export { Invite, ResetPassword } from './pages';
export { LiveChrome, SyncIndicator, AccountMenu } from './live';
export { StepUpHost } from './stepup';
