# NOVA security containment

**Nothing here has been applied.** This folder holds a change for the live NOVA database (Supabase project "Nova-crm") and its undo. It is applied by a person, IN: Supabase Dashboard, when the owner says so. The build that produced VYNTEX Command never touches NOVA.

NOVA is the older internal system of Lion Business Services. An audit of its code found weaknesses that are open today, while it is still in use. This change closes the ones that can be closed with permissions alone, without touching any client record and without changing how staff work. The rest is fixed by design in the new platform (`docs/security/legacy-defects.md`).

| File | What it is |
| --- | --- |
| `0020_security_containment.sql` | The change. Permissions and three definitions. No client data is read or changed. |
| `0020_security_containment_rollback.sql` | The undo. Puts back the state before the change, weaknesses included. |

## What it fixes

| Weakness today | After the change |
| --- | --- |
| Every database function in NOVA can be run by anyone who has the public browser key, with no sign-in. One of them returns the name and office of every client. | No function can be run without a sign-in, except the two the public review page needs (`get_review_request_by_token`, `submit_review`). Signed-in staff keep every function they had. |
| Anyone who creates an account becomes an associate (a role that can edit). | A new account starts as read only. The owner promotes real staff on the Team page. The very first account of an empty system still becomes owner. |
| The "clients you cannot see" list (name and office of every other client) is shown to every account, read only included. | Only working staff (associate and above) get that list. |
| Any signed-in account, read only included, can change or delete price tiers. | Everyone signed in can read price tiers. Senior associates and the owner can add and change them. Only the owner can delete them. |

Turning off public sign-up is a setting, not SQL. It is step 3 below and it matters as much as the SQL.

## What it does not fix

It is containment, not a cure. These stay as they are in NOVA and are listed so nobody assumes otherwise:

* Accounts that already exist keep their role. Someone who signed up before the change is still an associate. Step 4 below is the review of the account list.
* About 200 real customers are in a migration file in the NOVA Git repository. Removing them is a separate procedure: `docs/security/repository-cleaning.md`.
* The storage bucket `client-assets` is public.
* The old plain-text tax ID column on clients still exists and is readable by anyone who can see the client.
* Marking an appointment paid twice creates two credits. Senior associates can approve their own request to see a tax ID. Deleting a client deletes its audit entries.
* The CSV export is open to the read only role and is not logged.

The full list is in the NOVA audits. The new platform is where these are closed.

## What staff will notice

* The sign-up page stops working once step 3 is done. New people are created by the owner.
* A read only account sees an empty list on the "request access" page.
* An associate can no longer edit price tiers. A senior associate or the owner can.
* Nothing else changes. The public review page keeps working.

## What was tested, and what was not

Tested on 3 October 2026 on a local, throwaway PostgreSQL 16 loaded with NOVA's migration files 0001 to 0014 (the customer import files were left out on purpose) and local stand-ins for the parts Supabase provides. Fictional accounts only.

| Check | Before | After the change | After the undo |
| --- | --- | --- | --- |
| Functions that can be run with no sign-in, out of 40 | 40 | 2 (the two review functions) | 40 |
| Client directory function, no sign-in, with 2 sample clients | returns 2 rows | refused (permission denied) | returns 2 rows |
| Role given to a new account | associate | read only | associate |
| Client directory, read only account | not tested (the audit reads the code as open to every account) | 0 rows | |
| Client directory, associate account | 2 rows | 2 rows | |
| Price tier change by an account below senior | allowed | refused | allowed |
| Price tier change by the owner | allowed | allowed | |
| Price tiers readable by a read only account | yes | yes | |
| Review function with no sign-in | works | works | |
| The change run a second time without the undo | | stops at step 4 with "policy already exists" | |
| The change run again after the undo | | works | |

Not tested: the live NOVA database. Its functions or policies may differ from the migration files (the audit found places where the live database was changed by hand). That is why step 1 looks before anything is changed, and why the change is wrapped so that it applies completely or not at all.

## How to apply it

Do this at a quiet time. It takes a few minutes. No downtime is expected.

**1. Look first (reads only)**

1. IN: Supabase Dashboard. Open the project **Nova-crm**. Check the project name at the top of the page: this must not be run on any other project.
2. IN: Supabase Dashboard, SQL Editor. Press **New query**.
3. IN: Supabase Dashboard, SQL Editor. Paste this and press **Run**:

   ```sql
   select p.oid::regprocedure as function_name
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_review_request_by_token', 'submit_review', 'handle_new_user', 'inaccessible_clients_for_me',
                       'has_edit_role', 'has_senior_role', 'has_owner_role', 'can_view_client')
   order by 1;
   ```

4. Compare the result with this list. All eight lines must be there, written exactly like this:

   ```
   can_view_client(uuid)
   get_review_request_by_token(text)
   handle_new_user()
   has_edit_role()
   has_owner_role()
   has_senior_role()
   inaccessible_clients_for_me()
   submit_review(text,integer,text)
   ```

   If a line is missing or different, stop and send the result to the developer. The change would fail halfway through its checks, and it is better to know before.
5. IN: Supabase Dashboard, SQL Editor. Press **New query**, paste this and press **Run**. Keep the two numbers: this is the state before.

   ```sql
   select count(*) filter (where has_function_privilege('anon', p.oid, 'execute')) as runnable_without_login,
          count(*) as all_functions
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
   ```

**2. Apply the change**

1. IN: VS Code. Open `deploy/nova-containment/0020_security_containment.sql`.
2. IN: VS Code. Select all (Ctrl+A) and copy (Ctrl+C).
3. IN: Supabase Dashboard, SQL Editor. Press **New query**.
4. IN: Supabase Dashboard, SQL Editor. Type `begin;` on the first line.
5. IN: Supabase Dashboard, SQL Editor. Paste the file under it.
6. IN: Supabase Dashboard, SQL Editor. Type `commit;` on a new last line. With `begin;` and `commit;` around it, the change applies completely or not at all.
7. IN: Supabase Dashboard, SQL Editor. Press **Run**. If the editor warns that the query changes permissions or is destructive, read the warning and confirm.
8. Read the result. It is one row and it must say `open_without_login` **false** and `staff_can_use` **true**.

   If instead there is an error, nothing was changed. Copy the error text (it holds no secret) and send it to the developer. One known case: `policy "service_variations_insert" already exists` means the change was applied before. Do not run it twice; see "Running it again" below.

**3. Turn off public sign-up**

1. IN: Supabase Dashboard, project Nova-crm, Authentication.
2. IN: Supabase Dashboard, Authentication. Open **Sign In / Providers** (on some versions of the dashboard this is under Configuration).
3. IN: Supabase Dashboard, Authentication, Sign In / Providers. Turn **Allow new users to sign up** off.
4. IN: Supabase Dashboard. Press **Save**.

From now on a new person is added by the owner: IN: Supabase Dashboard, Authentication, Users, **Add user** (or **Invite**), and then the owner sets their role on NOVA's Team page.

**4. Review the accounts that already exist**

The change does not demote anyone. An account created by a stranger before today is still an associate.

1. IN: Supabase Dashboard, Authentication, Users. Read the whole list.
2. For every address that is not a current member of staff: IN: NOVA, Team page (signed in as the owner), set the role to read only.
3. For the same address: IN: Supabase Dashboard, Authentication, Users, open the menu at the end of the row and choose **Ban user**. (Deleting the user is the other choice on that menu. It also deletes that person's lead handoff history in NOVA, and it is refused for someone who has appointments, so banning is the safer one.)
4. Write down who was removed and when. If an unknown account exists, treat it as a possible incident: `docs/security/monitoring-and-incident-response.md`.

**5. Verify**

1. IN: Supabase Dashboard, SQL Editor. Run the query of step 1.5 again. `runnable_without_login` must now be **2**.
2. IN: Supabase Dashboard, SQL Editor. Press **New query**, paste this and press **Run**:

   ```sql
   select policyname, cmd from pg_policies where tablename = 'service_variations' order by 1;
   ```

   Expected: `service_variations_delete`, `service_variations_insert`, `service_variations_read`, `service_variations_update`, and no `service_variations_write`.
3. IN: a private browser window (not signed in to anything). Open NOVA's sign-up page and try to create an account with a made-up address. It must be refused.
4. IN: NOVA, signed in as an ordinary associate. Open a client, the schedule and the leads page. Everything must work as before.
5. IN: a browser. Open a review link from a recent review request (or create one). The review page must load.
6. Write the date and the two numbers of step 1.5 and step 5.1 in the security log of the firm. This is evidence for the written information security plan.

## How to roll back

Only if staff cannot work after the change and the developer cannot find the cause quickly. The undo reopens every weakness listed above.

1. IN: VS Code. Open `deploy/nova-containment/0020_security_containment_rollback.sql`, select all and copy.
2. IN: Supabase Dashboard, project Nova-crm, SQL Editor. Press **New query**.
3. IN: Supabase Dashboard, SQL Editor. Type `begin;` on the first line, paste the file, type `commit;` on a new last line.
4. IN: Supabase Dashboard, SQL Editor. Press **Run**.
5. IN: Supabase Dashboard, SQL Editor. Run the query of step 1.5. `runnable_without_login` is back to the number you wrote down before the change.
6. Leave **Allow new users to sign up** off. The undo does not need it on, and nothing in NOVA's daily work depends on it.
7. Tell the developer what failed, so the change can be corrected and applied again.

## Running it again

The change cannot be run twice in a row: its last step creates three policies and stops if they exist. To apply it again (for example after a correction), run the undo first and then the change. Both orders were tested locally: change, undo, change.
