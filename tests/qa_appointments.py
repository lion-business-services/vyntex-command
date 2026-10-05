# Appointments, credits and the calendar, end to end in the sample workspace of the professional-services edition, plus the
# calendar of two field editions (which must behave exactly as before: they have no appointments screen).
# Covers: booking with the slot finder, the double-booking refusal, prepayment, recording a payment once, cancelling by the
# office (credit) and by the client (company rule), using a credit once, voiding one, moving an appointment, outcomes,
# the release of an unpaid appointment, the settings section, roles, search, the client tab and the honest connection states.
# Usage: python3 tests/qa_appointments.py [lang]   (PORT selects the preview server, default 4173; lang en or es, default en)
# For the LBS preview build: NS=lbs ROOT=/preview python3 tests/qa_appointments.py
import asyncio, json, os, re, sys
from datetime import datetime, timedelta
from playwright.async_api import async_playwright

BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
NS = os.environ.get('NS', 'vyntex'); ROOT = os.environ.get('ROOT', '/demo')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
LANG = sys.argv[1] if len(sys.argv) > 1 else 'en'
RESULTS = []
KEY_RE = re.compile(r'(?<![\w@./-])(appointments|calendar|act|common|nav)\.[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]')

def record(name, ok, detail=''):
    RESULTS.append({'check': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else ': ' + str(detail)[:300]), flush=True)

async def state(pg, pack='practice'):
    return await pg.evaluate("([ns, pack]) => JSON.parse(localStorage.getItem(ns + '.demo.' + pack))", [NS, pack])
async def patch(pg, js, pack='practice'):
    """Changes the saved sample directly (to put an appointment in the past, which no screen can do) and reloads."""
    await pg.evaluate("([ns, pack, js]) => { const k = ns + '.demo.' + pack; const d = JSON.parse(localStorage.getItem(k)); new Function('d', js)(d); d.touched = true; localStorage.setItem(k, JSON.stringify(d)); }", [NS, pack, js])
async def view_as(pg, role):
    await pg.evaluate("([ns, role]) => { const k = ns + '.prefs'; const p = JSON.parse(localStorage.getItem(k)); p.viewAs = role; localStorage.setItem(k, JSON.stringify(p)); }", [NS, role])
async def goto(pg, path):
    await pg.goto(BASE + ROOT + path); await pg.wait_for_selector('h1', timeout=10000); await pg.wait_for_timeout(350)
def appt(d, id): return next((a for a in d['appointments'] if a['id'] == id), None)
def iso(dt): return dt.strftime('%Y-%m-%d')

async def page_text_ok(pg, name):
    text = await pg.evaluate("() => document.querySelector('#main')?.innerText || ''")
    m = KEY_RE.search(text)
    bad = m and not re.search(r'\.(com|org|net)$', m.group(0))
    record(f'{name}: no raw wording keys', not bad, m.group(0) if m else '')
    m2 = re.search(r'\{[A-Za-z_]+\}', text); record(f'{name}: no unfilled tokens', not m2, m2.group(0) if m2 else '')
    sw = await pg.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    record(f'{name}: no sideways scroll', sw[0] <= sw[1] + 1, sw)

async def book(pg, person, type_id, staff, date=None, time=None, kind='client'):
    """Fills the booking form. Without a date it takes the first free time the slot finder offers. Returns the error text or ''."""
    await pg.click('[data-testid=appointments-new]'); await pg.wait_for_selector('[data-testid=appointments-book-form]')
    if kind == 'lead': await pg.click('.modal .seg button:nth-child(2)')
    await pg.select_option('[data-testid=appointments-f-person]', person)
    await pg.select_option('[data-testid=appointments-f-type]', type_id)
    await pg.select_option('[data-testid=appointments-f-staff]', staff)
    await pg.wait_for_timeout(150)
    if date:
        await pg.fill('[data-testid=appointments-f-date]', date); await pg.fill('[data-testid=appointments-f-time]', time)
    else:
        await pg.click('[data-testid=appointments-slots] button:first-child')
    await pg.click('[data-testid=appointments-book-save]'); await pg.wait_for_timeout(400)
    err = pg.locator('[data-testid=appointments-book-error]')
    return (await err.inner_text()) if await err.count() else ''

async def practice(browser):
    ctx = await browser.new_context(viewport={'width': 1440, 'height': 900}); pg = await ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:200]))
    await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    await pg.goto(BASE + ROOT + ('' if NS == 'lbs' else f'?industry=practice&lang={LANG}')); await pg.wait_for_selector('#main', timeout=15000)
    await pg.evaluate("([ns, lang]) => { const k = ns + '.prefs'; const p = JSON.parse(localStorage.getItem(k) || '{}'); p.tourSeen = true; p.lang = lang; p.viewAs = 'owner'; localStorage.setItem(k, JSON.stringify(p)); }", [NS, LANG])

    # ---- the list
    await goto(pg, '/appointments')
    d0 = await state(pg)
    record('sample has appointments in every status', len({a['status'] for a in d0['appointments']}) == 9, {a['status'] for a in d0['appointments']})
    record('list shows rows', await pg.locator('[data-testid=appointments-table] tbody tr').count() > 0)
    await page_text_ok(pg, 'list')
    for tab in range(1, 5):
        await pg.click(f'.appointments-tabs .seg button:nth-child({tab})'); await pg.wait_for_timeout(120)
    await pg.click('.appointments-tabs .seg button:nth-child(3)'); await pg.wait_for_timeout(150)
    rows = await pg.locator('[data-testid=appointments-table] tbody tr').evaluate_all("els => els.map(e => e.dataset.status)")
    record('awaiting payment tab shows only those', rows and all(s == 'awaiting_payment' for s in rows), rows)
    await pg.click('.appointments-tabs .seg button:nth-child(4)')
    await pg.select_option('[data-testid=appointments-filter-status]', 'no_show'); await pg.wait_for_timeout(150)
    rows = await pg.locator('[data-testid=appointments-table] tbody tr').evaluate_all("els => els.map(e => e.dataset.status)")
    record('status filter', rows == ['no_show'], rows)
    await pg.select_option('[data-testid=appointments-filter-staff]', 'u1'); await pg.wait_for_timeout(150)
    record('filters with no match offer to clear', await pg.locator('.empty .btn').count() == 1)
    await pg.click('.empty .btn'); await pg.wait_for_timeout(150)
    record('clearing brings the rows back', await pg.locator('[data-testid=appointments-table] tbody tr').count() > 3)

    # ---- book a prepaid appointment with the first free time
    n0 = len(d0['appointments'])
    err = await book(pg, 'pc2', 'at6', 'u2')
    d = await state(pg); new = d['appointments'][0]
    record('booking a prepaid type waits for payment', not err and len(d['appointments']) == n0 + 1 and new['status'] == 'awaiting_payment' and new.get('payBy'), err or new)
    record('booking opens the appointment page', f"/appointments/{new['id']}" in pg.url, pg.url)
    start = datetime.strptime(new['date'] + ' ' + new['time'], '%Y-%m-%d %H:%M')
    record('the slot finder stays inside office hours on a working day', start.weekday() < 5 and '09:00' <= new['time'] < '17:00', new['date'] + ' ' + new['time'])
    record('pay-by is 24 hours before the start, or the start for a late booking', abs((start - datetime.fromisoformat(new['payBy'].replace('Z', '+00:00')).astimezone().replace(tzinfo=None)).total_seconds() - 86400) < 90 or start - datetime.now() < timedelta(hours=24), new['payBy'])
    await page_text_ok(pg, 'appointment page')
    record('payment link is off and says why', await pg.locator('[data-testid=appointments-pay-link]').is_disabled() and await pg.locator('#appt-link-why').count() == 1)
    record('video appointment without a provider shows no link', await pg.locator('[data-testid=appointments-no-meet]').count() == 1 and await pg.locator('[data-testid=appointments-meet]').count() == 0)
    record('calendar state says not connected', await pg.locator('[data-testid=appointments-sync-state]').count() == 1)
    href = await pg.locator('[data-testid=appointments-add-google]').get_attribute('href')
    record('add to Google link carries the date', href.startswith('https://calendar.google.com/calendar/render?') and new['date'].replace('-', '') in href, href[:120])

    # ---- double booking is refused: same person, overlapping time
    await goto(pg, '/appointments')
    err = await book(pg, 'pc7', 'at1', 'u2', new['date'], new['time'])
    d = await state(pg)
    record('double booking refused with a reason', bool(err) and len(d['appointments']) == n0 + 1, err)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)

    # ---- record the payment, once
    await goto(pg, f"/appointments/{new['id']}")
    await pg.click('[data-testid=appointments-pay]'); await pg.wait_for_selector('.modal form')
    await pg.fill('.modal input[type=number]', '50'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(200)
    record('less than the fee is refused in the form', await pg.locator('.modal [role=alert]').count() == 1 and not appt(await state(pg), new['id']).get('paid'))
    await pg.fill('.modal input[type=number]', '75'); await pg.fill('.modal input:not([type=number])', 'CHK 4471')
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(500)
    d = await state(pg); a = appt(d, new['id'])
    record('payment recorded confirms the appointment', a['status'] == 'confirmed' and a['paid']['amount'] == 75 and a['paid']['ref'] == 'CHK 4471' and a['paid']['method'] == 'check', a)
    record('no second payment control once paid', await pg.locator('[data-testid=appointments-pay]').count() == 0 and await pg.locator('[data-testid=appointments-pay-2]').count() == 0)
    record('paying is in the audit trail', any(x['action'] == 'appointment.paid' and x.get('entityId') == new['id'] for x in d['audit']))
    c0 = len(d['credits'])

    # ---- the office cancels a paid appointment: a credit
    await pg.click('[data-testid=appointments-cancel]'); await pg.wait_for_selector('[data-testid=appointments-cancel-reason]')
    await pg.click('[data-testid=appointments-cancel-save]'); await pg.wait_for_timeout(200)
    record('a cancellation needs a reason', appt(await state(pg), new['id'])['status'] == 'confirmed')
    await pg.click('.modal .seg button:nth-child(2)'); await pg.fill('[data-testid=appointments-cancel-reason]', 'Associate out sick')
    record('the dialog says a credit will be issued', await pg.locator('[data-testid=appointments-cancel-outcome]').get_attribute('data-outcome') == 'credit')
    await pg.click('[data-testid=appointments-cancel-save]'); await pg.wait_for_timeout(500)
    d = await state(pg); a = appt(d, new['id']); cr = d['credits'][0]
    record('cancelled by the office with a credit for what was paid', a['status'] == 'cancelled_staff' and len(d['credits']) == c0 + 1 and cr['amount'] == 75 and cr['reason'] == 'cancel_staff' and cr['fromApptId'] == new['id'] and cr['clientId'] == 'pc2', cr)

    # ---- credits: balance and ledger
    await goto(pg, '/appointments/credits')
    await page_text_ok(pg, 'credits')
    bal = await pg.locator('[data-testid=appointments-cr-balances] tbody tr:first-child td:nth-child(2)').inner_text()
    record('balance of the client adds both credits', '150.00' in bal, bal)
    record('ledger lists every entry', await pg.locator('[data-testid=appointments-cr-ledger] tbody tr').count() == c0 + 1)

    # ---- use a credit on another appointment, once
    await goto(pg, '/appointments')
    err = await book(pg, 'pc2', 'at6', 'u3')
    d = await state(pg); second = d['appointments'][0]
    await pg.click('[data-testid=appointments-use-credit]'); await pg.wait_for_selector('[data-testid=appointments-credit-save]')
    await pg.click('[data-testid=appointments-credit-save]'); await pg.wait_for_timeout(500)
    d = await state(pg); a = appt(d, second['id']); used = [c for c in d['credits'] if c.get('used', {}).get('apptId') == second['id']]
    record('a credit pays the fee and confirms', not err and a['status'] == 'confirmed' and a['paid']['method'] == 'credit' and len(used) == 1 and a.get('creditId') == used[0]['id'], a.get('paid'))
    record('the used credit no longer counts', sum(c['amount'] for c in d['credits'] if c['clientId'] == 'pc2' and not c.get('used') and not c.get('void')) == 75)
    record('no credit control on a paid appointment', await pg.locator('[data-testid=appointments-use-credit]').count() == 0)

    # ---- void the remaining credit
    await goto(pg, '/appointments/credits?client=pc2')
    await pg.click('[data-testid=appointments-cr-ledger] tr[data-state=active] [data-testid=appointments-cr-void]'); await pg.wait_for_selector('.modal textarea')
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(150)
    record('voiding needs a reason', not any(c.get('void') for c in (await state(pg))['credits']))
    await pg.fill('.modal textarea', 'Entered twice by mistake'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(500)
    d = await state(pg); voided = [c for c in d['credits'] if c.get('void')]
    record('credit voided with who and why, entry kept', len(voided) == 1 and voided[0]['void']['reason'] == 'Entered twice by mistake' and voided[0]['void']['by'] == 'u1' and len(d['credits']) == c0 + 1, voided)
    record('nothing left to void', await pg.locator('[data-testid=appointments-cr-void]').count() == 0)

    # ---- move an appointment: same id, earlier slot kept as history
    before = appt(d, 'pa6')
    await goto(pg, '/appointments/pa6')
    await pg.click('[data-testid=appointments-move]'); await pg.wait_for_selector('[data-testid=appointments-move-form]')
    await pg.click('[data-testid=appointments-move-save]'); await pg.wait_for_timeout(200)
    record('moving to the same time is refused', await pg.locator('[data-testid=appointments-move-error]').count() == 1)
    slots = pg.locator('[data-testid=appointments-move-form] [data-testid=appointments-slots] button')
    await slots.nth(2).click(); await pg.click('[data-testid=appointments-move-save]'); await pg.wait_for_timeout(500)
    d = await state(pg); a = appt(d, 'pa6'); hist = appt(d, a.get('rescheduledFrom', ''))
    record('moved: new time, same id, earlier slot linked', (a['date'], a['time']) != (before['date'], before['time']) and hist and hist['date'] == before['date'] and hist['status'].startswith('cancelled') and not hist.get('paid'), a)
    record('timeline shows the move', await pg.locator('[data-testid=appointments-timeline] li').count() >= 2)

    # ---- company rule: a late cancellation by the client keeps the payment
    await goto(pg, '/settings/appointments')
    await page_text_ok(pg, 'settings')
    record('default for late client cancellations is a credit, and the screen says so', (await pg.locator('[data-testid=appointments-set-clientcancel]').input_value()) == 'credit')
    await pg.select_option('[data-testid=appointments-set-clientcancel]', 'forfeit'); await pg.fill('[data-testid=appointments-set-creditdays]', '90')
    await pg.click('[data-testid=appointments-set-save]'); await pg.wait_for_timeout(300)
    d = await state(pg)
    record('rules saved', d['settings'].get('appointments', {}).get('clientCancel') == 'forfeit' and d['config']['appointments']['creditDays'] == 90, d['config'].get('appointments'))
    await pg.click('[data-testid=appointments-set-add]'); await pg.wait_for_selector('.modal form')
    inputs = pg.locator('.modal form input:not([type=checkbox])')
    await inputs.nth(0).fill('Year-end review'); await inputs.nth(1).fill('Revisión de fin de año'); await inputs.nth(2).fill('40'); await inputs.nth(3).fill('10')
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(300)
    d = await state(pg)
    record('appointment type added', any(x['name']['en'] == 'Year-end review' and x['minutes'] == 40 and x.get('buffer') == 10 for x in d['apptTypes']))
    soon = datetime.now() + timedelta(hours=3)
    soon = soon.replace(minute=(soon.minute // 5) * 5, second=0)
    await goto(pg, '/appointments')
    err = await book(pg, 'pc8', 'at6', 'u1', iso(soon), soon.strftime('%H:%M'))
    d = await state(pg); late = d['appointments'][0]
    record('late booking is due by its start', not err and late['status'] == 'awaiting_payment', err)
    await pg.click('[data-testid=appointments-pay]'); await pg.wait_for_selector('.modal form'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(500)
    await pg.click('[data-testid=appointments-cancel]'); await pg.wait_for_selector('[data-testid=appointments-cancel-reason]')
    await pg.fill('[data-testid=appointments-cancel-reason]', 'Cannot make it')
    record('the dialog says the payment is kept', await pg.locator('[data-testid=appointments-cancel-outcome]').get_attribute('data-outcome') == 'forfeit')
    await pg.click('.modal .seg button:nth-child(2)'); await pg.wait_for_timeout(100)
    record('the office cancelling still gives a credit', await pg.locator('[data-testid=appointments-cancel-outcome]').get_attribute('data-outcome') == 'credit')
    await pg.click('.modal .seg button:nth-child(1)'); n_cr = len(d['credits'])
    await pg.click('[data-testid=appointments-cancel-save]'); await pg.wait_for_timeout(500)
    d = await state(pg); a = appt(d, late['id'])
    record('late client cancellation: no credit, payment stays on record', a['status'] == 'cancelled_client' and len(d['credits']) == n_cr and a['paid']['amount'] == 75, a)

    # ---- outcomes need the start to have passed; then completed and no-show
    await goto(pg, '/appointments/pa5')
    record('no outcome controls before the start', await pg.locator('[data-testid=appointments-complete]').count() == 0 and await pg.locator('[data-testid=appointments-noshow]').count() == 0)
    yesterday = iso(datetime.now() - timedelta(days=1))
    await patch(pg, f"for (const a of d.appointments) if (a.id === 'pa5' || a.id === 'pa9') a.date = '{yesterday}';")
    await goto(pg, '/appointments/pa5')
    await pg.click('[data-testid=appointments-complete]'); await pg.wait_for_timeout(300)
    record('marked as completed', appt(await state(pg), 'pa5')['status'] == 'completed')
    await goto(pg, '/appointments/pa9')
    await pg.click('[data-testid=appointments-noshow]'); await pg.wait_for_timeout(250); await pg.click('.modal [data-autofocus]'); await pg.wait_for_timeout(300)
    record('recorded as a no-show', appt(await state(pg), 'pa9')['status'] == 'no_show')

    # ---- an unpaid appointment is released when the screen opens after its pay-by moment
    await patch(pg, "for (const a of d.appointments) if (a.id === 'pa4') a.payBy = new Date(Date.now() - 60000).toISOString();")
    await goto(pg, '/appointments')
    await pg.wait_for_timeout(300)
    d = await state(pg)
    record('unpaid appointment released by the sweep', appt(d, 'pa4')['status'] == 'cancelled_unpaid', appt(d, 'pa4')['status'])
    record('nothing else was released', all(a['status'] != 'cancelled_unpaid' or a['id'] in ('pa4', 'pa16') for a in d['appointments']))

    # ---- client tab, search
    await goto(pg, '/clients/pc2?tab=appointments')
    record('client tab: upcoming, history and credits', await pg.locator('[data-testid=clients-appt-upcoming]').count() == 1 and await pg.locator('[data-testid=clients-appt-history] .item').count() >= 2 and await pg.locator('[data-testid=clients-appt-credits]').count() == 1)
    await page_text_ok(pg, 'client tab')
    await pg.click('[data-testid=global-search]'); await pg.fill('[data-testid=search-input]', 'Whitcombe'); await pg.wait_for_timeout(350)
    groups = await pg.locator('.palette .grp').all_inner_texts()
    record('search finds appointments', any(g.strip() in ('Appointments', 'Citas') for g in groups), groups)
    await pg.keyboard.press('Escape')

    # ---- agenda, day and week
    await goto(pg, '/appointments?view=agenda')
    record('agenda day grid', await pg.locator('[data-testid=appointments-day-grid]').count() == 1)
    await pg.click('.appointments-agbar .seg button:nth-child(2)'); await pg.wait_for_timeout(200)
    record('agenda week grid', await pg.locator('[data-testid=appointments-week-grid]').count() == 1)
    await pg.click('[data-testid=appointments-ag-next]'); await pg.wait_for_timeout(200)
    await page_text_ok(pg, 'agenda')

    # ---- calendar: appointments with their own look, honest connection states
    await goto(pg, '/calendar?view=agenda')
    kinds = await pg.locator('[data-testid=calendar-legend] button').evaluate_all("els => els.map(e => e.dataset.kind)")
    record('calendar legend has appointments once', kinds.count('meet') == 1 and 'appt' not in kinds, kinds)
    record('appointments are on the calendar', await pg.locator('.cal-ev.k-meet').count() > 0)
    record('Google Calendar and Meet read as not connected', await pg.locator('[data-testid=calendar-conn-gcal]').get_attribute('data-state') == 'not_connected' and await pg.locator('[data-testid=calendar-conn-gmeet]').get_attribute('data-state') == 'not_connected')
    record('no video link is invented', await pg.locator('[data-testid=calendar-meet]').count() == 0)
    maps = await pg.locator('[data-testid=calendar-map]').first.get_attribute('href') if await pg.locator('[data-testid=calendar-map]').count() else ''
    record('office address opens a plain maps search', maps.startswith('https://www.google.com/maps/search/?api=1&query='), maps[:90])
    g = await pg.locator('.cal-ev.k-meet [data-testid=calendar-add-google]').first.get_attribute('href')
    record('add to Google kept on appointments', g.startswith('https://calendar.google.com/calendar/render?'))
    await page_text_ok(pg, 'calendar')

    # ---- roles
    await view_as(pg, 'readonly'); await goto(pg, '/appointments')
    record('read only: no booking control', await pg.locator('[data-testid=appointments-new]').count() == 0)
    await goto(pg, f"/appointments/{second['id']}")
    record('read only: no change controls on the appointment', await pg.locator('[data-testid=appointments-move], [data-testid=appointments-cancel], [data-testid=appointments-notes-save]').count() == 0)
    await goto(pg, '/appointments/credits')
    record('read only: ledger without a void control', await pg.locator('[data-testid=appointments-cr-ledger]').count() == 1 and await pg.locator('[data-testid=appointments-cr-void]').count() == 0)
    await view_as(pg, 'staff'); await goto(pg, '/appointments')
    record('associate: can book', await pg.locator('[data-testid=appointments-new]').count() == 1)
    await pg.goto(BASE + ROOT + '/settings/appointments'); await pg.wait_for_timeout(700)
    record('associate: no appointment settings', await pg.locator('[data-testid=appointments-set-rules]').count() == 0)
    await view_as(pg, 'owner')
    record('no console errors (practice)', not errs, errs[:3])
    await ctx.close()

async def field(browser, pack):
    """A field edition has no appointments screen: its calendar must be what it always was."""
    ctx = await browser.new_context(viewport={'width': 1440, 'height': 900}); pg = await ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:200]))
    await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    await pg.goto(BASE + f'/demo?industry={pack}&lang={LANG}'); await pg.wait_for_selector('#main', timeout=15000)
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs') || '{}'); p.tourSeen = true; p.viewAs = 'owner'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    await pg.goto(BASE + '/demo/calendar'); await pg.wait_for_selector('[data-testid=calendar-grid]')
    kinds = await pg.locator('[data-testid=calendar-legend] button').evaluate_all("els => els.map(e => e.dataset.kind)")
    record(f'{pack}: calendar legend as before', 'meet' not in kinds and kinds[:2] == ['appt', 'follow'], kinds)
    record(f'{pack}: sync card as before', await pg.locator('[data-testid=calendar-sync]').count() == 1 and await pg.locator('[data-testid=calendar-conn-gcal]').count() == 0)
    record(f'{pack}: no appointments in the menu', await pg.locator('nav a[href$="/appointments"]').count() == 0)
    # schedule a visit for a lead from the day panel, as before
    d = await state(pg, pack); lead_dates = {l['id']: l.get('apptDate') for l in d['leads']}
    target = iso(datetime.now() + timedelta(days=9)) if (datetime.now() + timedelta(days=9)).month == datetime.now().month else iso(datetime.now())
    await pg.click(f'.cal-day[data-date="{target}"] .cal-dn'); await pg.wait_for_timeout(200)
    await pg.click('[data-testid=calendar-day-visit]'); await pg.wait_for_selector('.modal form')
    lead_id = await pg.locator('.modal select').input_value()
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(350)
    d = await state(pg, pack); lead = next(l for l in d['leads'] if l['id'] == lead_id)
    record(f'{pack}: visit scheduled from the calendar', lead.get('apptDate') == target and lead_dates[lead_id] != target, lead.get('apptDate'))
    record(f'{pack}: the visit shows on that day', await pg.locator(f'.cal-day[data-date="{target}"] .cal-chip.k-appt').count() > 0 or await pg.locator('[data-testid=calendar-day] .cal-ev.k-appt').count() > 0)
    await pg.click('[data-testid=calendar-new-task]'); await pg.wait_for_selector('.modal form'); await pg.keyboard.press('Escape')
    await pg.goto(BASE + '/demo/calendar?view=agenda'); await pg.wait_for_selector('[data-testid=calendar-agenda]')
    g = await pg.locator('[data-testid=calendar-add-google]').first.get_attribute('href')
    record(f'{pack}: add to Google link', g.startswith('https://calendar.google.com/calendar/render?action=TEMPLATE'))
    await pg.click('[data-testid=calendar-legend] button[data-kind=task]'); await pg.wait_for_timeout(150)
    record(f'{pack}: legend toggles a kind', await pg.locator('.cal-ev.k-task').count() == 0)
    await pg.goto(BASE + '/demo/appointments'); await pg.wait_for_timeout(600)
    record(f'{pack}: the appointments address shows no appointments screen', await pg.locator('[data-testid=appointments-new]').count() == 0)
    record(f'{pack}: no console errors', not errs, errs[:3])
    await ctx.close()

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME)
        await practice(browser)
        if NS == 'vyntex':
            for pack in ('build', 'clean'): await field(browser, pack)
        await browser.close()
    bad = [r for r in RESULTS if not r['ok']]
    json.dump(RESULTS, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f'.qa-appointments-{NS}-{LANG}.json'), 'w'), indent=1)
    print(f"\n{len(RESULTS) - len(bad)} of {len(RESULTS)} checks passed")
    sys.exit(1 if bad else 0)
asyncio.run(main())
