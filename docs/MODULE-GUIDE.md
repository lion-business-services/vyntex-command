# Module guide: how a screen plugs into VYNTEX Command

For engineers building a module on the foundation. Read `docs/MASTER-BUILD-SPEC.md` first; this file is the practical part.
The reference for quality and structure is `src/features/leads/` (page, i18n, css) and `src/features/clients/`.

## Where things live

| What | Where |
|---|---|
| Data model | `src/domain/types.ts` (owned by the lead; ask for changes in your report, optional fields you add locally go through `extra` in the database) |
| Edition blueprint | `src/packs/types.ts`, `src/packs/blueprint.ts` (field editions), `src/packs/practice/pack.ts` |
| Company configuration readers | `src/domain/config.ts`: `stagesOf, stageOf, isWon, isLost, isOpen, stageByRole, openStages, firstStage, wonStage, lostStage, stageRole, isHot, sourcesOf, lostReasonsOf, taskTypesOf, clientTypesOf, moduleOn, roleLabel, permissionsOf, can, routingOf, appointmentRules, vaultRules, securityRules, leadIsOpen, leadIsWon, leadIsLost, openLeads` |
| Office scope | `src/domain/access.ts`: `canSeeClient, visibleClients, hiddenClients, canSeeLead, visibleLeads, visibleClientIds` |
| Actions | `src/domain/actions/<area>.ts`, all re-exported from `@/domain/actions`. Signature `(d: DemoState, ctx: Ctx, ...args)`; run with `act(action, ...args)` from `@/store/store` |
| Screens | `src/app/modules.ts` (`MODULES`). Your page is the default export of `src/features/<id>/index.tsx` with `PageProps { id?, sub? }` |
| Search | `src/app/search.ts`; your providers are `export const search: SearchProvider[]` in `src/features/<id>/search.ts` |
| Client profile tabs | `src/features/clients/tabs.ts`; your tab is the default export of `src/features/<id>/ClientTab.tsx` (`ClientTabProps { client, tabbed }`) |
| Settings sections | `src/features/settings/panels.ts`; yours is the default export of `src/features/<id>/SettingsPanel.tsx` |
| Wording | `src/features/<id>/i18n.ts` (already registered in `src/i18n/features.ts`); English and Spanish required, `zh` optional. `pick(l10n, lang)` reads an `L10n` |
| Sample business (practice) | `src/packs/practice/seed/<part>.ts`, composed by `seed.ts`; helpers in `seed/util.ts` |
| Protected operations | `gateway().protected.*` from `@/platform/gateway` (vault, members, appointment payment, credits, cash close, exports, lead rotation). In sample mode they answer with `sample: true` and never a real value |
| Connections | `gateway().integrations.*`. Never `connected` in sample mode |
| Files | `gateway().files.upload / url`. Sample mode keeps small data URLs in the browser |

`useApp()` gives `data, prefs, lang, pack, t, can(p), perms, user, live, priced, plan, isWorker, date, day, dateTime, time, standing`.
Gate every change control with `can('write')` (or `<CanWrite>` from `src/app/shared.tsx`) plus the specific capability.
`act()` and `mutate()` refuse without `write` as a backstop.

## Contracts between modules (final signatures; each has one owner)

```ts
// src/domain/rules/engine.ts            owner: automation
emit(d, ctx, event: RuleEvent, subject: RuleSubject): void
// src/domain/actions/appointments.ts    owner: appointments
bookAppointment(d, ctx, input: NewAppointment): BookResult
// src/domain/actions/catalog.ts         owner: catalog and engagements
startPlaybook(d, ctx, jobId: string): Task[]
// src/domain/actions/messages.ts        owner: communications
queueMessage(d, ctx, m: OutgoingMessage): QueueResult
// src/domain/actions/documents.ts       owner: documents
createDocFromTemplate(d, ctx, { kind, clientId, jobId?, leadId?, templateId? }): DocRecord | null
// src/domain/workflows.ts               owner: catalog and engagements (the won-lead workflow)
addWonLeadStep(step), wonLeadSteps
```

Rules of the road:

* Call another module only through these functions or by navigating to its screen (`go('/appointments?client=<id>')`).
  Never edit another module's folder. If the function you need is still a stub when you test, your code must cope with its
  "not available" answer; it will be filled in by its owner during this same round.
* After your action changes something a rule could react to, call `emit()` with the event from `RuleEvent` in types.ts.
* Anything that leaves the building (email, text, WhatsApp, a post, a call) goes through `queueMessage` or the module that
  owns that channel. In sample mode the result is `demo`, the screen says nothing was sent, and no connection is shown as connected.
* Money is `number` in dollars with cents, summed with the helpers in `src/lib/money.ts` (cent-safe); display with `money()`.
* Sample records: fictional people and businesses, `example.com` addresses, 555 phone numbers, last-four tax markers only.
* New optional fields you need on an existing type: use them through a local type extension only if unavoidable, and list
  them in your report so the lead adds them to `types.ts` (the database keeps unknown fields in `extra`, nothing is lost).

## Live mode (for awareness)

In live mode the store starts from the server, ids are UUIDs (`uid()` handles it), and every commit is diffed and sent to
`/api/ws/apply`. Collections the server owns are read-only for the browser: `audit, secureLog, reveals, credits,
connections, grants, users`. Change those only through `gateway().protected` / `gateway().integrations`. Your screens must
therefore never write to those lists directly, except through the sample implementations in `src/platform/sample.ts`.
