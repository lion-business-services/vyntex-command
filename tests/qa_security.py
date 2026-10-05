# End-to-end flows of the security center, the secure tax ID tab, the audit trail, Settings and the office team, in the
# professional-services edition's sample workspace: /demo?industry=practice (VYNTEX Command) or /preview (LBS Command).
# Checks, as a reviewer would meet them: the two-person rule and the single viewing of a tax ID, that no number is ever
# kept in the browser, invitations and roles, the last owner, access to a client of another office with an end date, the
# role matrix taking effect, the audit trail being read only, the Settings sections saving, and what each role cannot do.
# Usage: PORT=<port> python3 tests/qa_security.py [vyntex|lbs] [en|es] [desktop|phone]   (results in tests/.qa-security-<deploy>.json)
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
DEPLOY = sys.argv[1] if len(sys.argv) > 1 else 'vyntex'
LANG = sys.argv[2] if len(sys.argv) > 2 else 'en'
SIZE = sys.argv[3] if len(sys.argv) > 3 else 'desktop'
BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
APP = '/preview' if DEPLOY == 'lbs' else '/demo'
NS = 'lbs' if DEPLOY == 'lbs' else 'vyntex'
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
RESULTS = []
# a stand-in number, put together from parts so this file never holds one written out; it is typed into the sample and must not survive
NUMBER = '-'.join(['12', '3456789'])

def record(name, ok, detail=''):
    RESULTS.append({'check': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    if not ok: print(f'  FAIL {name}: {detail}', flush=True)

async def state(pg):
    return await pg.evaluate("(ns) => { const p = JSON.parse(localStorage.getItem(ns + '.prefs')); return { prefs: p, data: JSON.parse(localStorage.getItem(ns + '.demo.' + p.pack)) }; }", NS)

async def view_as(pg, role):
    """Switches the sample viewer the way the "View as" control does, then reloads so every screen reads it."""
    await pg.evaluate("([ns, role]) => { const k = ns + '.prefs'; const p = JSON.parse(localStorage.getItem(k)); p.viewAs = role; p.tourSeen = true; localStorage.setItem(k, JSON.stringify(p)); }", [NS, role])

async def open_page(pg, path, wait='#main'):
    await pg.goto(BASE + APP + path)
    await pg.wait_for_selector(wait, timeout=10000)
    await pg.wait_for_timeout(350)

async def confirm(pg):
    await pg.click('.modal [data-autofocus]'); await pg.wait_for_timeout(300)

async def main():
    w, h = (1440, 900) if SIZE == 'desktop' else (390, 844)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:200]))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        await pg.goto(f'{BASE}{APP}?industry=practice&lang={LANG}')
        await pg.wait_for_selector('#main h1')
        await view_as(pg, 'owner')
        s0 = (await state(pg))['data']
        record('sample firm loaded', s0['pack'] == 'practice' and len(s0['users']) >= 6, len(s0['users']))

        # ---------- people: invite, role, last owner, switch off and on, withdraw ----------
        await open_page(pg, '/security')
        record('security center opens on people', await pg.locator('[data-testid=security-users]').count() == 1)
        record('the sample is labelled', await pg.locator('[data-testid=security-sample-note]').count() >= 1)
        record('a seeded invitation shows as invited', await pg.locator('tr[data-state=invited]').count() == 1)
        await pg.click('[data-testid=security-user-add]')
        await pg.click('[data-testid=security-invite-send]'); await pg.wait_for_timeout(150)
        record('invite form refuses an empty name', await pg.locator('[data-testid=security-invite-error]').count() == 1)
        await pg.fill('[data-testid=security-invite-name]', 'Quinn Tester'); await pg.fill('[data-testid=security-invite-email]', 'marisol@example.com')
        await pg.click('[data-testid=security-invite-send]'); await pg.wait_for_timeout(250)
        record('invite refuses an address already on the team', await pg.locator('[data-testid=security-invite-error]').count() == 1)
        await pg.fill('[data-testid=security-invite-email]', 'quinn@example.com')
        await pg.click('[data-testid=security-invite-send]'); await pg.wait_for_timeout(400)
        s = (await state(pg))['data']
        quinn = next((u for u in s['users'] if u['email'] == 'quinn@example.com'), None)
        record('invited person is on the list, not active', quinn is not None and quinn.get('active') is False and bool(quinn.get('invitedAt')), quinn)
        record('the invitation is in the audit trail', s['audit'][0]['action'] == 'invite.created', s['audit'][0]['action'])
        owner_select = pg.locator('tr[data-user=u1] select')
        record('the last owner cannot be demoted', await owner_select.is_disabled())
        await pg.select_option('tr[data-user=u3] select', 'manager'); await pg.wait_for_timeout(300)
        s = (await state(pg))['data']
        record('role change saved and audited', next(u for u in s['users'] if u['id'] == 'u3')['role'] == 'manager' and s['audit'][0]['action'] == 'member.role_changed')
        await pg.select_option('tr[data-user=u3] select', 'staff'); await pg.wait_for_timeout(300)
        await pg.click('tr[data-user=u5] [data-testid=security-user-menu]'); await pg.click('[data-testid=security-user-disable]'); await confirm(pg)
        s = (await state(pg))['data']
        record('switched off: kept on the list, cannot sign in', next(u for u in s['users'] if u['id'] == 'u5').get('active') is False and len(s['users']) == len(s0['users']) + 1)
        await pg.click('tr[data-user=u5] [data-testid=security-user-menu]'); await pg.click('[data-testid=security-user-enable]'); await pg.wait_for_timeout(300)
        record('switched back on', next(u for u in (await state(pg))['data']['users'] if u['id'] == 'u5').get('active') is True)
        await pg.click(f"tr[data-user={quinn['id']}] [data-testid=security-user-menu]"); await pg.click('[data-testid=security-user-revoke]'); await confirm(pg)
        record('a withdrawn invitation leaves the list', not any(u['email'] == 'quinn@example.com' for u in (await state(pg))['data']['users']))

        # ---------- the two-person rule ----------
        await view_as(pg, 'manager')
        await open_page(pg, '/clients/pc7/secure', '[data-testid=security-client-tab]')
        record('the requester sees their request waiting', await pg.get_attribute('[data-testid=security-mine]', 'data-state') == 'pending')
        record('the requester has no way to approve it', await pg.locator('[data-testid=security-approve], [data-testid=security-confirm-self], [data-testid=security-open]').count() == 0)
        marker = await pg.inner_text('[data-testid=security-onfile]')
        record('only the type and last four digits are shown', '7203' in marker and not re.search(r'\d{2}-\d{7}', marker), marker[:80])
        await view_as(pg, 'owner')
        await open_page(pg, '/security/approvals')
        record('the approver sees the request in the queue', await pg.locator('[data-testid=security-queue-reveals] [data-request=rv1]').count() == 1)
        await pg.click('[data-request=rv1] [data-testid=security-approve]'); await pg.wait_for_timeout(400)
        s = (await state(pg))['data']
        rv1 = next(r for r in s['reveals'] if r['id'] == 'rv1')
        record('approved by the second person, with an expiry', rv1['status'] == 'approved' and rv1['approverId'] == 'u1' and bool(rv1.get('expiresAt')))
        await open_page(pg, '/clients/pc7/secure', '[data-testid=security-client-tab]')
        record('the approver cannot open it', await pg.locator('[data-testid=security-open]').count() == 0)
        await view_as(pg, 'manager')
        await open_page(pg, '/clients/pc7/secure', '[data-testid=security-client-tab]')
        await pg.click('[data-testid=security-open]'); await pg.wait_for_selector('[data-testid=security-reveal]')
        panel = await pg.inner_text('[data-testid=security-reveal]')
        record('the viewing panel says no real tax ID exists', ('no real tax ID exists' in panel) or ('ningún número fiscal real' in panel), panel[:160])
        record('the value is masked and counts down', '7203' in panel and '•' in panel and await pg.locator('[data-testid=security-reveal-timer]').count() == 1)
        t1 = await pg.inner_text('[data-testid=security-reveal-timer]'); await pg.wait_for_timeout(2200); t2 = await pg.inner_text('[data-testid=security-reveal-timer]')
        record('the countdown is running', t1 != t2, f'{t1} / {t2}')
        record('the value cannot be selected', await pg.evaluate("() => getComputedStyle(document.querySelector('[data-testid=security-reveal-value]')).userSelect") == 'none')
        await pg.click('[data-testid=security-reveal-copy]'); await pg.wait_for_timeout(300)
        s = (await state(pg))['data']
        record('the copy is logged', s['secureLog'][0]['action'] == 'export' and s['secureLog'][0]['requestId'] == 'rv1', s['secureLog'][0])
        await pg.click('[data-testid=security-reveal-close]'); await pg.wait_for_timeout(300)
        record('closing hides the panel', await pg.locator('[data-testid=security-reveal]').count() == 0)
        s = (await state(pg))['data']
        record('the request is used up: one viewing', next(r for r in s['reveals'] if r['id'] == 'rv1')['status'] == 'used' and await pg.locator('[data-testid=security-open]').count() == 0)
        actions = [e['action'] for e in s['secureLog'] if e.get('requestId') == 'rv1']
        record('every step is in the access log', actions == ['export', 'reveal', 'approve', 'request'], actions)
        record('the log has no edit or delete control', await pg.locator('[data-testid=security-log] button, [data-testid=security-log] input').count() == 0)

        # ---------- storing a number: checked, discarded, never kept ----------
        await view_as(pg, 'owner')
        await open_page(pg, '/clients/pc10/secure', '[data-testid=security-client-tab]')
        await pg.click('[data-testid=security-tax-edit]'); await pg.wait_for_selector('[data-testid=security-tax-form]')
        field = pg.locator('[data-testid=security-tax-value]')
        record('the field is not remembered by the browser', await field.get_attribute('autocomplete') == 'off' and await field.get_attribute('name') is None)
        masked = await pg.evaluate("() => { const el = document.querySelector('[data-testid=security-tax-value]'); return el.type === 'password' || getComputedStyle(el).webkitTextSecurity === 'disc'; }")
        record('typing is masked', masked)
        await pg.select_option('[data-testid=security-tax-type]', 'ein')
        await field.fill('12-34'); await pg.click('[data-testid=security-tax-save]'); await pg.wait_for_timeout(150)
        record('a number of the wrong shape is refused', await pg.locator('[data-testid=security-tax-error]').count() == 1)
        await field.fill(''); await field.type(NUMBER.replace('-', ''))
        record('dashes are put in while typing', await field.input_value() == NUMBER, await field.input_value())
        await pg.click('[data-testid=security-tax-toggle]')
        record('the show switch lifts the mask', await pg.evaluate("() => { const el = document.querySelector('[data-testid=security-tax-value]'); return el.type === 'text' && getComputedStyle(el).webkitTextSecurity !== 'disc'; }"))
        await pg.click('[data-testid=security-tax-save]'); await pg.wait_for_timeout(500)
        everything = await pg.evaluate("() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))) + JSON.stringify(Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]))) + location.href + document.documentElement.outerHTML")
        record('the number is nowhere: not in storage, the address or the page', NUMBER not in everything and NUMBER.replace('-', '') not in everything)
        s = (await state(pg))['data']
        pc10 = next(c for c in s['clients'] if c['id'] == 'pc10')
        record('only the type and last four digits were kept', pc10.get('taxIdType') == 'ein' and pc10.get('taxIdLast4') == NUMBER[-4:])
        record('storing it is in the access log', s['secureLog'][0]['action'] == 'set' and s['secureLog'][0]['clientId'] == 'pc10')

        # ---------- single authorised person: identity check, then own approval ----------
        await open_page(pg, '/security/signin')
        await pg.click('[data-testid=security-vault-step_up]'); await pg.click('[data-testid=security-vault-save]'); await pg.wait_for_timeout(300)
        record('approval rule saved', (await state(pg))['data']['config']['vault']['approval'] == 'step_up')
        await open_page(pg, '/clients/pc10/secure', '[data-testid=security-client-tab]')
        await pg.click('[data-testid=security-ask]')
        await pg.click('[data-testid=security-ask-send]'); await pg.wait_for_timeout(150)
        record('a request without a reason is refused', await pg.locator('[data-testid=security-ask-form] [role=alert]').count() == 1)
        await pg.fill('[data-testid=security-ask-reason]', 'State filing for the quarter')
        await pg.click('[data-testid=security-ask-send]'); await pg.wait_for_selector('[data-testid=security-stepup]')
        record('the identity check is asked for, labelled as a sample', await pg.locator('[data-testid=security-stepup] .note').count() == 1)
        await pg.click('[data-testid=security-stepup-continue]'); await pg.wait_for_timeout(500)
        record('approved under the requester\'s own name', await pg.get_attribute('[data-testid=security-mine]', 'data-state') == 'approved')
        await pg.click('[data-testid=security-open]'); await pg.wait_for_selector('[data-testid=security-reveal]')
        await pg.click('[data-testid=security-reveal-close]'); await pg.wait_for_timeout(200)
        await open_page(pg, '/security/signin')
        await pg.click('[data-testid=security-vault-second_person]'); await pg.click('[data-testid=security-vault-save]'); await pg.wait_for_timeout(300)

        # ---------- access to a client of another office, with an end date ----------
        await open_page(pg, '/security/approvals')
        await pg.fill('[data-request=ar2] [data-testid=security-access-until]', '2099-01-31')
        await pg.click('[data-request=ar2] [data-testid=security-access-approve]'); await pg.wait_for_timeout(400)
        s = (await state(pg))['data']
        grant = next((g for g in s['grants'] if g['userId'] == 'u3' and g['clientId'] == 'pc9'), None)
        record('access granted with its end date', grant is not None and grant.get('expires') == '2099-01-31', grant)

        # ---------- roles and permissions ----------
        await open_page(pg, '/security/roles')
        record('the owner column is locked', await pg.locator('td[data-role=owner] input').count() == 0)
        record('read only can never be given write or delete', await pg.locator('[data-testid=security-cap-readonly-write], [data-testid=security-cap-readonly-delete]').count() == 0)
        await pg.click('[data-testid=security-cap-staff-reports]')
        record('a change waits to be saved', (await state(pg))['data']['config'].get('roles') is None)
        await pg.click('[data-testid=security-roles-save]'); await pg.wait_for_timeout(300)
        s = (await state(pg))['data']
        record('the matrix is saved to the company configuration', 'reports' in s['config']['roles']['staff'] and s['audit'][0]['action'] == 'config.roles', s['audit'][0])
        await view_as(pg, 'staff')
        await open_page(pg, '/reports')
        record('the role can now open what it was given', await pg.locator('[data-testid=security-users]').count() == 0 and 'reports' in pg.url and await pg.locator('.empty').count() == 0)
        await open_page(pg, '/security')
        record('an associate cannot open the security center', await pg.locator('[data-testid=security-tabs]').count() == 0)
        await open_page(pg, '/clients/pc1/secure', '[data-testid=security-client-tab]')
        record('an associate sees the marker and no way to ask', await pg.locator('[data-testid=security-onfile]').count() == 1 and await pg.locator('[data-testid=security-ask], [data-testid=security-tax-edit]').count() == 0)
        await view_as(pg, 'readonly')
        await open_page(pg, '/clients/pc1/secure', '[data-testid=security-client-tab]')
        record('read only sees the marker and no control', await pg.locator('[data-testid=security-onfile]').count() == 1 and await pg.locator('[data-testid=security-client-tab] button').count() == 0)
        await open_page(pg, '/audit')
        record('read only cannot open the audit trail', await pg.locator('[data-testid=audit-table]').count() == 0)
        await view_as(pg, 'owner')
        await open_page(pg, '/security/roles')
        await pg.click('[data-testid=security-roles-reset-staff]'); await pg.wait_for_timeout(300)
        record('a role goes back to how it ships', (await state(pg))['data']['config'].get('roles') is None)

        # ---------- offices ----------
        await open_page(pg, '/security/offices')
        await pg.click('[data-testid=security-office-add]'); await pg.fill('[data-testid=security-office-name]', 'Sample North office')
        await pg.click('[data-testid=security-office-save]'); await pg.wait_for_timeout(400)
        s = (await state(pg))['data']
        record('office added, one main office', any(o['name'] == 'Sample North office' for o in s['offices']) and sum(1 for o in s['offices'] if o.get('main')) == 1)
        record('an office with clients cannot be removed', await pg.locator('[data-office=o1] [data-testid=security-office-remove]').count() == 0)

        # ---------- audit trail ----------
        await open_page(pg, '/audit', '[data-testid=audit-table]')
        rows = await pg.locator('[data-testid=audit-table] tbody tr').count()
        record('the audit trail has entries', rows >= 20, rows)
        record('no edit or delete control exists in the trail', await pg.locator('[data-testid=audit-table] button, [data-testid=audit-table] input, [data-testid=audit-table] select').count() == 0)
        await pg.select_option('[data-testid=audit-filter-action]', 'vault'); await pg.wait_for_timeout(250)
        vault_rows = await pg.locator('[data-testid=audit-table] tbody tr').count()
        only = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=audit-table] tbody tr')].every((r) => r.dataset.action.startsWith('vault.'))")
        record('the action filter narrows the trail', 0 < vault_rows < rows and only, vault_rows)
        await pg.click('[data-testid=audit-clear]'); await pg.wait_for_timeout(200)
        before = len((await state(pg))['data']['audit'])
        async with pg.expect_download() as dl:
            await pg.click('[data-testid=audit-export]')
        file = await dl.value
        text = open(await file.path(), encoding='utf-8-sig').read()
        s = (await state(pg))['data']
        record('the trail downloads as a file', file.suggested_filename.startswith('audit-') and text.splitlines()[0].startswith('when,who,action'), file.suggested_filename)
        record('the download is itself in the trail', len(s['audit']) == before + 1 and s['audit'][0]['action'] == 'export.audit', s['audit'][0]['action'])
        record('no number in the exported trail', not re.search(r'\d{3}-\d{2}-\d{4}|\d{2}-\d{7}', text))

        # ---------- settings ----------
        await open_page(pg, '/settings')
        await pg.fill('[data-testid=settings-legal-name]', 'Sample Legal Name LLC'); await pg.fill('[data-testid=settings-website]', 'example.com')
        await pg.click('[data-testid=settings-save]'); await pg.wait_for_timeout(300)
        co = (await state(pg))['data']['company']
        record('company profile saved', co.get('legalName') == 'Sample Legal Name LLC' and co.get('website') == 'https://example.com', co)
        accent = await pg.locator('[data-testid=settings-accent]').count()
        record('accent colour only where the brand allows it', accent == (0 if DEPLOY == 'lbs' else 1), accent)
        record('plan section only for a priced edition', await pg.locator('[data-testid=settings-tab-plan]').count() == 0)
        await open_page(pg, '/settings/modules')
        record('core screens cannot be switched off', await pg.locator('[data-testid=settings-module-clients], [data-testid=settings-module-security]').count() == 0)
        await pg.click('[data-testid=settings-module-social]'); await pg.wait_for_timeout(300)
        record('a screen switched off leaves the menu', (await state(pg))['data']['config']['modules'].get('social') is False and await pg.locator('.nav a[href$="/social"]').count() == 0)
        await pg.click('[data-testid=settings-module-social]'); await pg.wait_for_timeout(300)
        record('and comes back when switched on', await pg.locator('.nav a[href$="/social"]').count() == 1)
        await open_page(pg, '/settings/wording')
        await pg.fill('[data-testid=settings-word-en-project]', 'Matter'); await pg.fill('[data-testid=settings-word-en-projects]', 'Matters')
        await pg.fill('[data-testid=settings-word-es-project]', 'Asunto'); await pg.fill('[data-testid=settings-word-es-projects]', 'Asuntos')
        await pg.click('[data-testid=settings-words-save]'); await pg.wait_for_timeout(300)
        nav = await pg.inner_text('.nav')
        record('the company\'s own word is used across the workspace', ('Matters' in nav) or ('Asuntos' in nav), nav[:120])
        await pg.click('[data-testid=settings-words-reset]'); await pg.wait_for_timeout(300)
        nav = await pg.inner_text('.nav')
        record('reset brings the edition\'s wording back', 'Matters' not in nav and 'Asuntos' not in nav)
        await open_page(pg, '/settings/lists')
        await pg.click('[data-testid=settings-list-add-clientTypes]')
        await pg.locator('[data-testid=settings-list-en-clientTypes]').last.fill('Trust')
        await pg.click('[data-testid=settings-list-save-clientTypes]'); await pg.wait_for_timeout(300)
        record('a client type added', any(o['id'] == 'trust' for o in (await state(pg))['data']['config'].get('clientTypes', [])))
        await pg.locator('[data-testid=settings-list-remove-clientTypes]').first.click(); await pg.wait_for_timeout(200)
        record('a type in use cannot be removed', len((await state(pg))['data']['config']['clientTypes']) == 8 and await pg.locator('[data-testid=settings-list-clientTypes] ~ [role=alert]').count() == 1)
        await open_page(pg, '/settings/links')
        shipped = await pg.locator('[data-testid=settings-links] [data-link]').count()
        record('quick links: the ones this deployment ships are listed', shipped == (2 if DEPLOY == 'lbs' else 0), shipped)
        if DEPLOY == 'lbs':
            record('a shipped link has no invented address', await pg.get_attribute('[data-link=bookkeeping]', 'data-set') == 'no')
            await pg.click('[data-testid=settings-link-set-bookkeeping]'); await pg.fill('[data-testid=settings-link-url]', 'not an address'); await pg.click('[data-testid=settings-link-save]'); await pg.wait_for_timeout(150)
            record('only a web address is accepted', await pg.locator('[data-testid=settings-link-form] [role=alert]').count() == 1)
            await pg.fill('[data-testid=settings-link-url]', 'https://books.example.com/start'); await pg.click('[data-testid=settings-link-save]'); await pg.wait_for_timeout(300)
            record('an owner sets the address of a shipped link', await pg.get_attribute('[data-link=bookkeeping]', 'data-set') == 'yes')
        else:
            await pg.click('[data-testid=settings-link-add]'); await pg.fill('[data-testid=settings-link-name]', 'Sample client link'); await pg.fill('[data-testid=settings-link-url]', 'https://example.com/link')
            await pg.click('[data-testid=settings-link-save]'); await pg.wait_for_timeout(300)
            record('a company adds its own link', await pg.locator('[data-testid=settings-links] [data-link]').count() == 1)
        await open_page(pg, '/settings/data', '[data-testid=settings-retention]')
        record('data and privacy: exports and what is kept', await pg.locator('[data-testid=settings-exports] button').count() >= 4 and await pg.locator('[data-testid=settings-retention] li').count() == 4)
        record('web address section only in the product sold to companies', await pg.locator('[data-testid=settings-tab-domain]').count() == (0 if DEPLOY == 'lbs' else 1))
        page_text = ''
        for path in ['/security', '/security/signin', '/settings/data', '/audit']:
            await open_page(pg, path); page_text += await pg.inner_text('#main')
        record('no certification or compliance claim on these screens', not re.search(r'SOC ?2|HIPAA|\bPCI\b|IRS[- ]compliant|certified|certificad[oa] |cumple con', page_text, re.I))

        # ---------- the office team ----------
        await open_page(pg, '/team', '[data-testid=team-office]')
        record('team shows the active people', await pg.locator('[data-testid=team-person]').count() == 6)
        await pg.click('[data-user=u4]'); await pg.wait_for_selector('[data-testid=team-workload]')
        s = (await state(pg))['data']
        open_tasks = sum(1 for t in s['tasks'] if t['assignee'] == 'u:u4' and t['status'] != 'done')
        shown = await pg.inner_text('[data-testid=team-workload]')
        record('workload is counted from the records', str(open_tasks) in shown, f'{open_tasks} in {shown[:80]!r}')
        await pg.click('[data-testid=team-profile-edit]'); await pg.fill('[data-testid=team-profile-title]', 'Senior tax associate (sample)')
        await pg.fill('[data-testid=team-profile-away-from]', ''); await pg.fill('[data-testid=team-profile-away-to]', '')
        await pg.click('[data-testid=team-profile-save]'); await pg.wait_for_timeout(400)
        u4 = next(u for u in (await state(pg))['data']['users'] if u['id'] == 'u4')
        record('profile saved, absence cleared', u4.get('title') == 'Senior tax associate (sample)' and 'away' not in u4, u4)
        await view_as(pg, 'staff')
        await open_page(pg, '/team/u2', '[data-testid=team-workload]')
        record('an associate cannot edit someone else\'s profile', await pg.locator('[data-testid=team-profile-edit]').count() == 0)
        await open_page(pg, '/team/u3', '[data-testid=team-workload]')
        record('and can edit their own', await pg.locator('[data-testid=team-profile-edit]').count() == 1)

        record('no console errors', not errs, errs[:3])
        await b.close()
    ok = sum(1 for r in RESULTS if r['ok']); bad = [r for r in RESULTS if not r['ok']]
    json.dump(RESULTS, open(os.path.join(ROOT, f'.qa-security-{DEPLOY}.json'), 'w'), indent=1)
    print(f'checks passed: {ok} / {len(RESULTS)}')
    for r in bad: print('FAIL', '|', r['check'], '|', r['detail'])

asyncio.run(main())
