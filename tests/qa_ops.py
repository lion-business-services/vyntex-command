# End-to-end flows of the practice operations modules, in the professional-services sample workspace:
# home screen (counts that open their own list, client links), tasks (client requests, comments and mentions, bulk
# reassign), payments (record against an engagement, balances, receipt, Square state), reports (every tab and breakdown),
# petty cash (entry, close, lock, approval), deadlines (add, complete and roll forward, import, month view), and the
# payroll, bookkeeping and licensing screens.
# Usage: python3 tests/qa_ops.py [demo|preview]      PORT selects the preview server.
#   demo      a VYNTEX Command build: /demo?industry=practice (default)
#   preview   an LBS Command build made with VX_SAMPLE_PREVIEW=1: /preview
import asyncio, json, os, sys, tempfile
from playwright.async_api import async_playwright

BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
KIND = sys.argv[1] if len(sys.argv) > 1 else 'demo'
ROOT = '/preview' if KIND == 'preview' else '/demo'
NS = 'lbs' if KIND == 'preview' else 'vyntex'
RESULTS = []

def record(name, ok, detail=''):
    RESULTS.append({'check': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    if not ok: print(f'  FAIL {name}: {detail}', flush=True)

async def state(pg):
    return await pg.evaluate("(ns) => JSON.parse(localStorage.getItem(ns + '.demo.practice'))", NS)

async def view_as(pg, role):
    await pg.evaluate("([ns, role]) => { const p = JSON.parse(localStorage.getItem(ns + '.prefs')); p.viewAs = role; p.tourSeen = true; localStorage.setItem(ns + '.prefs', JSON.stringify(p)); }", [NS, role])

async def go(pg, path):
    await pg.goto(BASE + ROOT + path); await pg.wait_for_selector('#main h1, #main .empty'); await pg.wait_for_timeout(350)

def cents(n): return round(float(n) * 100)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:200]))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        await pg.goto(BASE + ROOT + ('?industry=practice&lang=en' if KIND == 'demo' else '?lang=en')); await pg.wait_for_selector('#main h1')
        await view_as(pg, 'owner')
        s0 = await state(pg)
        record('the practice sample is loaded', s0 and s0['pack'] == 'practice' and len(s0['cash']) > 10 and len(s0['complianceItems']) > 5, s0 and s0.get('pack'))
        owner = next(u for u in s0['users'] if u['role'] == 'owner'); manager = next(u for u in s0['users'] if u['role'] == 'manager')

        # ---------- home screen
        await go(pg, '')
        tiles = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=dash-glance] [role=tab]')].map(x => ({ id: x.dataset.testid.replace('dash-g-', ''), n: Number(x.dataset.count) }))")
        record('home: the eight counts are shown to the owner', len(tiles) == 8, tiles)
        ok = True; bad = ''
        for scope in ['mine', 'firm']:
            if scope == 'firm': await pg.click('.dash-glance .seg button:nth-child(2)'); await pg.wait_for_timeout(200)
            tl = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=dash-glance] [role=tab]')].map(x => ({ id: x.dataset.testid, n: Number(x.dataset.count) }))")
            for t in tl:
                await pg.click(f"[data-testid={t['id']}]"); await pg.wait_for_timeout(120)
                rows = await pg.locator('[data-testid=dash-g-panel] .dash-g-row').count()
                more = await pg.locator('[data-testid=dash-g-panel] .dash-more').count()
                shown = await pg.evaluate("() => Number(document.querySelector('[data-testid=dash-g-panel] .count').textContent)")
                if shown != t['n'] or rows != min(t['n'], 6) or (more == 1) != (t['n'] > 6): ok = False; bad = f"{scope} {t['id']} count={t['n']} rows={rows} more={more}"
        record('home: every count opens exactly the records it counted', ok, bad)
        record('home: firm figures shown to people who may see reports', await pg.locator('[data-testid=dash-firm] .kpi').count() >= 4)
        record('home: the attention list includes personal notices (a mention of the owner)', await pg.locator('[data-testid=dash-attention] [data-kind=mention]').count() == 1)
        if KIND == 'preview':
            links = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=dash-links] .dash-link')].map(x => x.dataset.set)")
            record('LBS home: bookkeeping and payroll client links are there, not set, and no address is made up', links == ['no', 'no'], links)
            body = await pg.inner_text('[data-testid=dash-links]')
            record('LBS home: an empty link says "Address not set"', body.count('Address not set') == 2, body[:120])
            await pg.click('[data-testid=dash-link-bookkeeping-set]'); await pg.fill('[data-testid=dash-link-url]', 'javascript:alert(1)'); await pg.click('[data-testid=dash-link-save]'); await pg.wait_for_timeout(200)
            record('LBS home: an address that is not a web address is refused', not (await state(pg))['config'].get('quickLinks'))
            await pg.fill('[data-testid=dash-link-url]', 'https://books.example.com/client'); await pg.click('[data-testid=dash-link-save]'); await pg.wait_for_timeout(300)
            cfg = (await state(pg))['config'].get('quickLinks') or []
            record('LBS home: the address is saved to the company configuration', any(l['id'] == 'bookkeeping' and l['url'] == 'https://books.example.com/client' for l in cfg), cfg)
            await pg.click('[data-testid=dash-link-bookkeeping-copy]'); await pg.wait_for_timeout(200)
            record('LBS home: Copy link puts the address on the clipboard', await pg.evaluate('navigator.clipboard.readText()') == 'https://books.example.com/client')
            await pg.click('[data-testid=dash-link-bookkeeping-send]'); await pg.wait_for_timeout(700)
            record('LBS home: Send to a client opens the communications screen', '/messages' in pg.url, pg.url)
            record('LBS home: the composer opens', await pg.locator('.modal').count() >= 1)
            # the communications screen asks who the link is for, then opens that conversation with the link written in
            # (QA pass: this was a note that always passed while the composer did not take the text; it is a check now)
            await pg.locator('[data-testid=messages-pick]').first.click(); await pg.wait_for_timeout(700)
            body = await pg.locator('[data-testid=messages-reply-body]').input_value() if await pg.locator('[data-testid=messages-reply-body]').count() else ''
            record('LBS home: the composer is prefilled with the link', 'books.example.com' in body, body[:80])
            await view_as(pg, 'staff'); await go(pg, '')
            record('LBS home: staff sees the links and cannot change the address', await pg.locator('[data-testid=dash-links] .dash-link').count() == 2 and await pg.locator('[data-testid=dash-link-payroll-set]').count() == 0)
            await view_as(pg, 'owner')
        else:
            record('VYNTEX practice: no shipped client links, the owner can add one', await pg.locator('[data-testid=dash-links] .dash-link').count() == 0 and await pg.locator('[data-testid=dash-link-add]').count() == 1)

        # ---------- tasks: client request, comment with a mention, bulk reassign
        await go(pg, '/tasks')
        record('tasks: the status board keeps its five columns', await pg.locator('[data-testid=tasks-board] .kcol').count() == 5)
        await pg.click('[data-testid=tasks-new-request]')
        await pg.locator('.modal select').first.select_option(index=1)
        await pg.locator('.modal input').first.fill('Flow test request'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(400)
        s = await state(pg); req = next((t for t in s['tasks'] if t['title'] == 'Flow test request'), None)
        record('tasks: a client request is recorded with who asked, how and for whom', req and req.get('type') == 'client_request' and req.get('clientId') and req.get('requestedBy') and req.get('channel'), req)
        await go(pg, '/tasks?view=requests')
        record('tasks: the request shows in its own view with its age', await pg.locator(f"[data-testid=tasks-requests] [data-task={req['id']}]").count() == 1 and '0 days' in await pg.inner_text(f"[data-task={req['id']}]"))
        await pg.click(f"[data-task={req['id']}] .tasks-reqtitle"); await pg.wait_for_selector('[data-testid=tasks-comment-text]')
        first = manager['name'].split(' ')[0]
        await pg.fill('[data-testid=tasks-comment-text]', 'Can you take this one? @' + first[:3]); await pg.wait_for_timeout(200)
        record('tasks: typing @ offers the colleagues it could be', await pg.locator('.tasks-offers button').count() >= 1)
        await pg.locator('.tasks-offers button', has_text=manager['name']).click(); await pg.click('[data-testid=tasks-comment-send]'); await pg.wait_for_timeout(300)
        s = await state(pg); t2 = next(t for t in s['tasks'] if t['id'] == req['id'])
        record('tasks: the comment records the person mentioned', (t2.get('comments') or [{}])[0].get('mentions') == [manager['id']], t2.get('comments'))
        await pg.keyboard.press('Escape')
        await view_as(pg, 'manager'); await go(pg, '')
        att = await pg.inner_text('[data-testid=dash-attention]')
        record('tasks: the mentioned person finds it under "You were mentioned"', 'Flow test request' in att and await pg.locator('[data-kind=mention]').count() == 1, att[:160])
        await go(pg, '/tasks?view=list')
        await pg.click('[data-testid=tasks-bulk]'); await pg.wait_for_selector('[data-testid=tasks-bulk-bar]')
        n_open = await pg.locator('.tasks-pick').count()
        await pg.locator('[data-testid=tasks-bulk-bar] input[type=checkbox]').check()
        await pg.select_option('[data-testid=tasks-bulk-to]', 'u:' + owner['id']); await pg.click('[data-testid=tasks-bulk-apply]'); await pg.wait_for_timeout(400)
        s = await state(pg)
        visible_open = [t for t in s['tasks'] if t['status'] != 'done']
        record('tasks: a manager hands several open tasks to one person', n_open > 3 and sum(1 for t in visible_open if t['assignee'] == 'u:' + owner['id']) >= n_open - 1, f"{n_open} listed")
        await view_as(pg, 'staff'); await go(pg, '/tasks?view=list')
        record('tasks: an associate has no bulk reassign', await pg.locator('[data-testid=tasks-bulk]').count() == 0)
        await pg.select_option('[data-testid=tasks-group]', 'client'); await pg.wait_for_timeout(200)
        record('tasks: the list groups by client', await pg.locator('[data-testid=tasks-list-by][data-by=client] .tasks-group').count() >= 2)
        await go(pg, '/tasks'); await pg.select_option('[data-testid=tasks-cols]', 'person'); await pg.wait_for_timeout(200)
        record('tasks: the board shows a column per person', await pg.locator('[data-testid=tasks-board-by][data-by=person] .kcol').count() >= 3)
        await view_as(pg, 'readonly'); await go(pg, '/tasks')
        record('tasks: read only has no new-task or new-request button', await pg.locator('[data-testid=tasks-new]').count() == 0 and await pg.locator('[data-testid=tasks-new-request]').count() == 0)
        await view_as(pg, 'owner')

        # ---------- payments
        await go(pg, '/payments?tab=balances')
        s = await state(pg)
        record('payments: Square is reported as not connected in a sample workspace', await pg.get_attribute('[data-testid=payments-square]', 'data-state') == 'not_connected')
        record('payments: no pay-a-worker action in a practice', await pg.locator('[data-testid=payments-pay]').count() == 0)
        before = cents((await pg.inner_text('[data-testid=payments-table-owing] tfoot td.num')).replace('$', '').replace(',', ''))
        owed = sum(max(0, cents(j['price']) - sum(cents(r['amount']) for r in j['received'])) for j in s['jobs'] if j['status'] in ('progress', 'done'))
        record('payments: the open balance total is the sum of fee minus received, to the cent', before == owed, f'{before} vs {owed}')
        await pg.locator('[data-testid=payments-record-row]').first.click()
        await pg.locator('.modal input[type=number]').first.fill('1.25'); await pg.locator('.modal input').nth(2).fill('FLOW-1'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(400)
        after = cents((await pg.inner_text('[data-testid=payments-table-owing] tfoot td.num')).replace('$', '').replace(',', ''))
        record('payments: a payment recorded against an engagement lowers the balance by that amount', before - after == 125, f'{before} -> {after}')
        await pg.click('[data-testid=payments-tab-received]'); await pg.wait_for_timeout(200)
        s = await state(pg); pay = next((r for j in s['jobs'] for r in j['received'] if r['amount'] == 1.25), None)
        record('payments: the payment keeps its method and reference', pay and pay.get('ref') == 'FLOW-1' and pay.get('method'), pay)
        await pg.locator('[data-testid=payments-table-received] tbody tr').first.locator('a.btn').click(); await pg.wait_for_selector('[data-testid=payments-receipt]')
        rc = await pg.inner_text('[data-testid=payments-receipt]')
        record('payments: a receipt opens for the payment', '$1.25' in rc and 'FLOW-1' in rc, rc[:160])
        await go(pg, '/payments')
        await pg.click('[data-testid=payments-tab-balances]'); await pg.wait_for_timeout(200)
        buckets = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=payments-aging] .payments-age .v')].map(x => Number(x.textContent.replace(/[$,]/g, '')))")
        record('payments: the four age buckets add up to the open balance', len(buckets) == 4 and abs(sum(buckets) - after / 100) < 2, f'{buckets} vs {after / 100}')
        async with pg.expect_download(timeout=8000) as dl:
            await pg.click('[data-testid=payments-csv]')
        d = await dl.value
        record('payments: the balances export downloads as CSV and is written to the audit trail', d.suggested_filename.endswith('.csv') and any(a['action'].startswith('export') for a in (await state(pg))['audit']), d.suggested_filename)

        # ---------- reports: every tab and breakdown draws, with figures from records
        await go(pg, '/reports')
        tabs = await pg.evaluate("() => [...document.querySelectorAll('.reports [role=tab]')].map(x => x.dataset.testid.replace('reports-tab-', ''))")
        record('reports: the practice tabs', tabs == ['sales', 'money', 'work', 'appointments', 'growth', 'profit'], tabs)
        seen = 0; bad = []
        for tb in tabs:
            await go(pg, '/reports/' + tb)
            views = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=reports-view] button')].length")
            for i in range(max(views, 1)):
                errs.clear()
                if views: await pg.locator('[data-testid=reports-view] button').nth(i).click(); await pg.wait_for_timeout(180)
                txt = await pg.inner_text('#main')
                figs = await pg.locator('[data-testid=reports-figures] > div').count()
                table = await pg.locator('[data-testid=reports-table] tbody tr').count(); empty = await pg.locator('#main .empty').count()
                seen += 1
                if errs or figs < 3 or 'NaN' in txt or 'undefined' in txt or 'reports.' in txt or (table == 0 and empty == 0): bad.append(f'{tb}#{i} figs={figs} rows={table} empty={empty} errs={errs[:1]}')
        record(f'reports: all {seen} breakdowns draw their figures and a table or an honest empty state', seen >= 20 and not bad, bad[:3])
        await go(pg, '/reports/money?by=aging')
        async with pg.expect_download(timeout=8000) as dl:
            await pg.click('[data-testid=reports-csv]')
        record('reports: a report downloads as CSV', (await dl.value).suggested_filename.endswith('.csv'))
        await view_as(pg, 'staff'); await go(pg, '/reports'); await pg.wait_for_timeout(200)
        record('reports: an associate has no reports', await pg.locator('[data-testid=reports-figures]').count() == 0)
        await view_as(pg, 'owner')

        # ---------- petty cash
        await go(pg, '/cash')
        s = await state(pg); n_cash = len(s['cash']); n_close = len(s['cashCloses'])
        bal0 = cents((await pg.inner_text('[data-testid=cash-kpi-balance] .v')).replace('$', '').replace(',', ''))
        await pg.click('[data-testid=cash-new]'); await pg.fill('[data-testid=cash-amount]', '12.50'); await pg.fill('[data-testid=cash-memo]', 'Flow test entry'); await pg.click('[data-testid=cash-save]'); await pg.wait_for_timeout(350)
        s = await state(pg); e = next((x for x in s['cash'] if x['memo'] == 'Flow test entry'), None)
        bal1 = cents((await pg.inner_text('[data-testid=cash-kpi-balance] .v')).replace('$', '').replace(',', ''))
        record('cash: an entry is recorded with its person and office', e and e['amount'] == 12.5 and e['dir'] == 'out' and e['by'] == owner['id'] and len(s['cash']) == n_cash + 1, e)
        record('cash: the drawer balance moves by the entry, to the cent', bal0 - bal1 == 1250, f'{bal0} -> {bal1}')
        await pg.click('[data-testid=cash-close]')
        expected = cents((await pg.inner_text('[data-testid=cash-close-expected]')).replace('$', '').replace(',', ''))
        record('cash: the close shows what the drawer should hold', expected == bal1, f'{expected} vs {bal1}')
        await pg.fill('[data-testid=cash-counted]', f'{(expected - 100) / 100:.2f}'); await pg.wait_for_timeout(120)
        record('cash: the difference is worked out as the count is typed', '$1.00 short' in await pg.inner_text('[data-testid=cash-close-diff]'))
        await pg.click('[data-testid=cash-close-save]'); await pg.wait_for_timeout(250)
        record('cash: a difference without a note is refused', len((await state(pg))['cashCloses']) == n_close)
        await pg.fill('[data-testid=cash-close-note]', 'Flow test: one dollar short'); await pg.click('[data-testid=cash-close-save]'); await pg.wait_for_timeout(450)
        s = await state(pg); c = s['cashCloses'][0] if len(s['cashCloses']) == n_close + 1 else None
        record('cash: the day is closed with expected, counted and difference', c and cents(c['expected']) == expected and cents(c['counted']) == expected - 100 and cents(c['diff']) == -100 and c['by'] == owner['id'] and not c.get('approvedBy'), c)
        mine = [x for x in s['cash'] if (x.get('officeId') or '') == ((c or {}).get('officeId') or '')]
        record('cash: every entry of that drawer up to the close is locked', c and all(x.get('closeId') for x in mine if x['date'] <= c['date']), len(mine))
        record('cash: the close is written to the audit trail', any(a['action'] == 'cash.close' for a in s['audit']))
        record('cash: the person who counted cannot approve their own count', await pg.locator('[data-testid=cash-approve]').count() == 0)
        await pg.click('.cash [role=tab]:nth-child(1)'); await pg.wait_for_timeout(200)
        record('cash: locked entries offer no edit or delete', await pg.locator('[data-entry] .cash-lock').count() >= 5 and await pg.locator(f"[data-entry='{e['id']}'] .iconbtn").count() == 0)
        await pg.click('[data-testid=cash-new]'); await pg.fill('[data-testid=cash-amount]', '5'); await pg.click('[data-testid=cash-save]'); await pg.wait_for_timeout(250)
        record('cash: nothing can be added to a day that is closed', len((await state(pg))['cash']) == n_cash + 1)
        await pg.keyboard.press('Escape')
        await view_as(pg, 'manager'); await go(pg, '/cash'); await pg.click('.cash [role=tab]:nth-child(2)'); await pg.wait_for_timeout(200)
        await pg.click('[data-testid=cash-approve]'); await pg.wait_for_timeout(300)
        record('cash: a manager who did not count approves the close', (await state(pg))['cashCloses'][0].get('approvedBy') == manager['id'])
        async with pg.expect_download(timeout=8000) as dl:
            await pg.click('.cash [role=tab]:nth-child(1)'); await pg.click('[data-testid=cash-csv]')
        record('cash: the ledger exports as CSV for people who may export', (await dl.value).suggested_filename.endswith('.csv'))
        await view_as(pg, 'readonly'); await go(pg, '/cash')
        record('cash: read only sees the ledger and no way to change it', await pg.locator('[data-testid=cash-ledger] tbody tr').count() > 5 and await pg.locator('[data-testid=cash-new]').count() == 0 and await pg.locator('[data-testid=cash-close]').count() == 0)
        await view_as(pg, 'owner')

        # ---------- deadlines
        await go(pg, '/deadlines')
        s = await state(pg); n_dl = len(s['complianceItems'])
        text = await pg.inner_text('#main')
        record('deadlines: sample items are marked as samples', text.count('(sample)') >= 6)
        record('deadlines: the screen says it ships no dates of its own', 'does not come with filing dates' in text)
        await pg.click('[data-testid=deadlines-new]')
        await pg.locator('.modal input').first.fill('Flow renewal (sample)'); await pg.locator('.modal input[type=date]').fill('2031-01-31')
        await pg.locator('.modal select').nth(1).select_option('monthly'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(300)
        s = await state(pg); it = next((x for x in s['complianceItems'] if x['title'] == 'Flow renewal (sample)'), None)
        record('deadlines: a deadline is added', it and it['due'] == '2031-01-31' and it.get('repeat') == 'monthly' and it['status'] == 'open', it)
        await pg.locator(f"[data-deadline='{it['id']}'] [data-testid=deadlines-complete]").click(); await pg.click('[data-testid=deadlines-complete-save]'); await pg.wait_for_timeout(300)
        s = await state(pg); mine = [x for x in s['complianceItems'] if x['title'] == 'Flow renewal (sample)']
        record('deadlines: completing a repeating item keeps it as done and opens the next one', len(mine) == 2 and sorted(x['status'] for x in mine) == ['done', 'open'] and next(x for x in mine if x['status'] == 'open')['due'] == '2031-02-28', [(x['status'], x['due']) for x in mine])
        csv = tempfile.NamedTemporaryFile('w', suffix='.csv', delete=False)
        csv.write('title,due,kind,repeat,client,note\nImported one (sample),2031-05-01,license,yearly,,from the flow test\nImported two (sample),5/15/2031,filing,,,\nNo date (sample),someday,filing,,,\n'); csv.close()
        await pg.click('[data-testid=deadlines-import]'); await pg.set_input_files('[data-testid=deadlines-import-file]', csv.name); await pg.wait_for_selector('[data-testid=deadlines-import-result]')
        res = await pg.inner_text('[data-testid=deadlines-import-result]')
        record('deadlines: the import reads the file and says which lines it leaves out', 'Ready to add: 2' in res and 'Lines left out: 1' in res and 'Line 4' in res, res[:160])
        await pg.click('[data-testid=deadlines-import-run]'); await pg.wait_for_timeout(300)
        s = await state(pg)
        record('deadlines: the imported rows are added', len(s['complianceItems']) == n_dl + 4 and any(x['title'] == 'Imported two (sample)' and x['due'] == '2031-05-15' for x in s['complianceItems']), len(s['complianceItems']))
        await go(pg, '/deadlines?view=calendar')
        record('deadlines: the month view shows the days with something due', await pg.locator('[data-testid=deadlines-calendar] .deadlines-cell.has').count() >= 1)
        await pg.click('[data-testid=global-search]'); await pg.fill('[data-testid=search-input]', 'Imported one'); await pg.wait_for_timeout(300)
        record('deadlines: the command palette finds a deadline', await pg.locator('.palette .hit').count() >= 1)
        await pg.keyboard.press('Escape')
        cid = next(x['clientId'] for x in s['complianceItems'] if x.get('clientId'))
        await go(pg, f'/clients/{cid}/tasks')
        record('deadlines: a client\'s deadlines show on the client page', await pg.locator('[data-deadline]').count() >= 1)

        # ---------- payroll, bookkeeping, licensing
        for line, n in [('payroll', 5), ('bookkeeping', 5), ('licensing', 4)]:
            await go(pg, '/' + line)
            txt = await pg.inner_text('#main')
            record(f'{line}: says what is still needed, item by item', await pg.locator(f'[data-testid={line}-needed] li').count() == n and txt.count('Not supplied yet') == n)
            record(f'{line}: shows the engagements of its service line from the records', await pg.locator(f'[data-testid={line}-jobs] tbody tr').count() >= 1)
            record(f'{line}: the staff application has no address until the company sets one', await pg.get_attribute(f'[data-testid={line}-staff-link]', 'data-set') == 'no')
            record(f'{line}: no rate, percentage or dollar figure is shown', '%' not in txt and '$' not in txt, [w for w in txt.split() if '%' in w or '$' in w][:3])
        await go(pg, '/payroll')
        await pg.click('[data-testid=payroll-staff-link-set]'); await pg.fill('[data-testid=dash-link-url]', 'staff.example.com/payroll'); await pg.click('[data-testid=dash-link-save]'); await pg.wait_for_timeout(300)
        record('payroll: the staff application address is saved by the company', ((await state(pg))['settings'].get('payroll') or {}).get('staffUrl') == 'https://staff.example.com/payroll')
        await pg.click('[data-testid=payroll-category]'); await pg.select_option('[data-testid=bookkeeping-category-select]', 'bookkeeping'); await pg.click('[data-testid=bookkeeping-category-save]'); await pg.wait_for_timeout(300)
        record('payroll: the company chooses which service line the screen follows', 'Bookkeeping' in await pg.inner_text('[data-testid=payroll-showing]'))
        if KIND == 'preview':
            record('LBS payroll: the payroll client link is on the payroll screen', await pg.locator('[data-testid=dash-link-payroll]').count() == 1)
        await go(pg, '/licensing')
        n_lic = await pg.locator('[data-testid=licensing-holders] [data-deadline]').count()
        await pg.click('[data-testid=licensing-new]'); await pg.locator('.modal input').first.fill('Flow license (sample)'); await pg.locator('.modal input[type=date]').fill('2031-03-01'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(300)
        lic = next((x for x in (await state(pg))['complianceItems'] if x['title'] == 'Flow license (sample)'), None)
        record('licensing: a license is a dated record with its renewal', lic and lic['kind'] == 'license' and lic.get('repeat') == 'yearly' and await pg.locator('[data-testid=licensing-holders] [data-deadline]').count() == n_lic + 1, lic)
        await view_as(pg, 'staff'); await go(pg, '/payroll')
        record('payroll: an associate cannot change the settings of the screen', await pg.locator('[data-testid=payroll-category]').count() == 0 and await pg.locator('[data-testid=payroll-staff-link-set]').count() == 0)

        record('no console errors during the flows', not errs, errs[:3])
        await b.close()
    failed = [r for r in RESULTS if not r['ok']]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), f'.qa-ops-{KIND}.json')
    json.dump(RESULTS, open(out, 'w'), indent=1)
    for r in RESULTS:
        if r['check'].startswith('note:'): print(' ', r['check'], '->', r['detail'])
    print(f'{KIND}: checks {len(RESULTS)}, failed {len(failed)}')
    sys.exit(1 if failed else 0)

asyncio.run(main())
