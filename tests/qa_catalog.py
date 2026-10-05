# Service catalog, engagements, the won-lead workflow and cross-sell, end to end in the sample workspace.
# Professional-services edition: the catalog (create, edit, tiers, duplicate, retire, a catalog of 150 services and 250
# tiers, CSV export and import), playbooks, creating an engagement from a service and tier, billing, a repeating engagement
# rolling forward, winning a lead (client, engagements, playbook, welcome draft, kickoff task, history), opportunities and
# cross-sell rules, the client tabs, search and roles.
# Field editions: the job form and the job page are exactly as before while the company keeps no catalog, and gain the
# service picker once it has one, in the edition's own words.
# Usage: python3 tests/qa_catalog.py [practice|build|clean ...] [lang]   (PORT selects the preview server, default 4173)
# For the LBS preview build: NS=lbs ROOT=/preview python3 tests/qa_catalog.py practice
import asyncio, json, os, re, sys, time
from playwright.async_api import async_playwright

BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
NS = os.environ.get('NS', 'vyntex'); ROOT = os.environ.get('ROOT', '/demo')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
ARGS = sys.argv[1:]
LANG = next((a for a in ARGS if a in ('en', 'es')), 'en')
PACKS = [a for a in ARGS if a not in ('en', 'es')] or ['practice', 'build', 'clean']
HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = []
KEY_RE = re.compile(r'(?<![\w@./-])(catalog|opportunities|jobs|act|common|nav|doc|ts|pr)\.[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]')

def record(run, name, ok, detail=''):
    RESULTS.append({'run': run, 'check': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else ': ' + str(detail)[:300]), flush=True)

async def state(pg, pack):
    return await pg.evaluate("([ns, pack]) => JSON.parse(localStorage.getItem(ns + '.demo.' + pack))", [NS, pack])
async def patch(pg, pack, js):
    """Changes the saved sample directly (a large catalog, a screen switched on) and leaves the reload to the caller."""
    await pg.evaluate("([ns, pack, js]) => { const k = ns + '.demo.' + pack; const d = JSON.parse(localStorage.getItem(k)); new Function('d', js)(d); d.touched = true; localStorage.setItem(k, JSON.stringify(d)); }", [NS, pack, js])
async def view_as(pg, role):
    await pg.evaluate("([ns, role]) => { const k = ns + '.prefs'; const p = JSON.parse(localStorage.getItem(k)); p.viewAs = role; localStorage.setItem(k, JSON.stringify(p)); }", [NS, role])
async def goto(pg, path):
    await pg.goto(BASE + ROOT + path); await pg.wait_for_selector('h1', timeout=10000); await pg.wait_for_timeout(350)
async def confirm(pg):
    await pg.click('.modal [data-autofocus]'); await pg.wait_for_timeout(300)
def by(lst, id): return next((x for x in lst if x['id'] == id), None)

async def text_ok(pg, run, name):
    text = await pg.evaluate("() => document.querySelector('#main')?.innerText || ''")
    m = KEY_RE.search(text)
    bad = m and not re.search(r'\.(com|org|net|csv)$', m.group(0))
    record(run, f'{name}: no raw wording keys', not bad, m.group(0) if m else '')
    m2 = re.search(r'\{[A-Za-z_]+\}', text); record(run, f'{name}: no unfilled tokens', not m2, m2.group(0) if m2 else '')
    sw = await pg.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    record(run, f'{name}: no sideways scroll', sw[0] <= sw[1] + 1, sw)
    return text

async def open_workspace(browser, pack, w=1440, h=900):
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    pg = await ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:200]))
    await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    q = f'?industry={pack}&lang={LANG}' if ROOT == '/demo' else f'?lang={LANG}'
    await pg.goto(BASE + ROOT + q); await pg.wait_for_selector('#main h1', timeout=15000)
    await pg.evaluate("([ns, lang]) => { const k = ns + '.prefs'; const p = JSON.parse(localStorage.getItem(k) || '{}'); p.tourSeen = true; p.lang = lang; p.viewAs = 'owner'; localStorage.setItem(k, JSON.stringify(p)); }", [NS, LANG])
    return ctx, pg, errs

# ---------------------------------------------------------------------------------------------------------------------
async def practice(browser):
    run = f'practice/{LANG}/{NS}'
    print('flow', run, flush=True)
    ctx, pg, errs = await open_workspace(browser, 'practice')
    s0 = await state(pg, 'practice')
    record(run, 'sample: 12 to 16 services, playbooks, rules and opportunities', 12 <= len(s0['catalog']) <= 16 and 2 <= len(s0['playbooks']) <= 3 and 3 <= len(s0['crossSell']) <= 4 and len(s0['opportunities']) >= 4, [len(s0['catalog']), len(s0['playbooks']), len(s0['crossSell']), len(s0['opportunities'])])
    record(run, 'sample: no service is linked to an outside system', not any(x.get('externalIds') for x in s0['catalog']))

    # C1 the list: groups, search, filters
    await goto(pg, '/catalog')
    text = await text_ok(pg, run, 'catalog list')
    active = [x for x in s0['catalog'] if x['active']]
    record(run, 'catalog lists every active service, grouped by category', await pg.locator('[data-testid=catalog-list] tr[data-service]').count() == len(active) and await pg.locator('[data-testid=catalog-group]').count() == len(set(x['category'] for x in active)))
    await pg.fill('.catalog-filters input[type=search]', 'TAX-IND'); await pg.wait_for_timeout(200)
    record(run, 'search by code finds one service', await pg.locator('tr[data-service]').count() == 1)
    await pg.fill('.catalog-filters input[type=search]', 'zzzz'); await pg.wait_for_timeout(200)
    record(run, 'no match shows a way to clear the filters', await pg.locator('[data-testid=catalog-clear-empty]').count() == 1)
    await pg.click('[data-testid=catalog-clear-empty]')
    await pg.click('.catalog-filters .seg button:nth-child(2)'); await pg.wait_for_timeout(200)
    record(run, 'retired filter shows only retired services', await pg.locator('tr[data-service]').count() == len(s0['catalog']) - len(active))
    await pg.click('[data-testid=catalog-clear]')
    await pg.select_option('[data-testid=catalog-filter-repeat]', 'any'); await pg.wait_for_timeout(200)
    record(run, 'repeats filter', await pg.locator('tr[data-service]').count() == len([x for x in active if x.get('repeat') and x['repeat'] != 'once']))
    await pg.click('[data-testid=catalog-clear]')

    # C2 create a service with two tiers
    await pg.click('[data-testid=catalog-new]'); await pg.wait_for_selector('[data-testid=catalog-f-name]')
    await pg.click('[data-testid=catalog-save]'); await pg.wait_for_timeout(150)
    record(run, 'a service without a name is refused', await pg.locator('.modal [role=alert]').count() == 1)
    await pg.fill('[data-testid=catalog-f-name]', 'Flow test service'); await pg.fill('[data-testid=catalog-f-name-es]', 'Servicio de prueba')
    await pg.select_option('[data-testid=catalog-f-category]', 'advisory')
    await pg.fill('[data-testid=catalog-f-code]', 'FLOW-1')
    await pg.locator('[data-testid=catalog-f-tier-name]').nth(0).fill('Basic'); await pg.locator('[data-testid=catalog-f-tier-price]').nth(0).fill('abc')
    await pg.click('[data-testid=catalog-f-tier-add]')
    await pg.locator('[data-testid=catalog-f-tier-name]').nth(1).fill('Plus'); await pg.locator('[data-testid=catalog-f-tier-price]').nth(1).fill('1,250.50')
    await pg.locator('[data-testid=catalog-f-tier-unit]').nth(1).select_option('month')
    await pg.click('[data-testid=catalog-save]'); await pg.wait_for_timeout(150)
    record(run, 'a price that is not a number is refused', await pg.locator('.modal [role=alert]').count() == 1)
    await pg.locator('[data-testid=catalog-f-tier-price]').nth(0).fill('99')
    await pg.select_option('[data-testid=catalog-f-repeat]', 'monthly')
    await pg.click('[data-testid=catalog-save]'); await pg.wait_for_timeout(500)
    s = await state(pg, 'practice'); svc = next((x for x in s['catalog'] if x.get('code') == 'FLOW-1'), None)
    record(run, 'service created with two tiers in order, prices as numbers', svc is not None and [(t['name'], t['price'], t['unit']) for t in svc['tiers']] == [('Basic', 99, 'flat'), ('Plus', 1250.5, 'month')] and svc['i18n']['es']['name'] == 'Servicio de prueba' and svc.get('repeat') == 'monthly', svc and svc['tiers'])
    if not svc: await ctx.close(); return
    sid = svc['id']
    record(run, 'the new service opens on its own page', f'/catalog/{sid}' in pg.url, pg.url)
    await text_ok(pg, run, 'service page')
    await pg.locator('[data-testid=catalog-tier-down]').first.click(); await pg.wait_for_timeout(250)
    s = await state(pg, 'practice'); svc = by(s['catalog'], sid)
    record(run, 'tiers reorder and keep their ids', [t['name'] for t in svc['tiers']] == ['Plus', 'Basic'])
    # C3 edit, duplicate, retire
    await pg.click('[data-testid=catalog-edit]'); await pg.wait_for_selector('[data-testid=catalog-f-name]')
    record(run, 'edit form opens with the saved values', await pg.input_value('[data-testid=catalog-f-name]') == 'Flow test service' and await pg.locator('[data-testid=catalog-f-tier-name]').count() == 2)
    await pg.locator('[data-testid=catalog-f-tier-price]').nth(1).fill('120'); await pg.select_option('[data-testid=catalog-f-playbook]', 'pb-return')
    await pg.click('[data-testid=catalog-save]'); await pg.wait_for_timeout(400)
    s = await state(pg, 'practice'); svc2 = by(s['catalog'], sid)
    record(run, 'edit saves the price and keeps tier ids', svc2['tiers'][1]['price'] == 120 and [t['id'] for t in svc2['tiers']] == [t['id'] for t in svc['tiers']] and svc2.get('playbookId') == 'pb-return')
    await pg.click('[data-testid=catalog-duplicate]'); await pg.wait_for_timeout(500)
    s = await state(pg, 'practice'); copies = [x for x in s['catalog'] if x['name'].startswith('Flow test service (')]
    record(run, 'duplicate makes a separate service with new ids', len(copies) == 1 and copies[0]['id'] != sid and not set(t['id'] for t in copies[0]['tiers']) & set(t['id'] for t in svc2['tiers']) and f"/catalog/{copies[0]['id']}" in pg.url)
    await pg.click('[data-testid=catalog-retire]'); await confirm(pg)
    s = await state(pg, 'practice')
    record(run, 'retire switches the service off', by(s['catalog'], copies[0]['id'])['active'] is False)
    await goto(pg, '/jobs'); await pg.click('[data-testid=jobs-new]'); await pg.wait_for_selector('[data-testid=jobs-f-service]')
    opts = await pg.locator('[data-testid=jobs-f-service] option').evaluate_all('els => els.map(e => e.value)')
    record(run, 'a retired service cannot be picked for new work', copies[0]['id'] not in opts and sid in opts and 's-paper' not in opts)
    await pg.keyboard.press('Escape')

    # C4 playbooks
    await goto(pg, '/catalog/playbooks'); await text_ok(pg, run, 'playbooks')
    await pg.click('[data-testid=catalog-pb-new]'); await pg.wait_for_selector('[data-testid=catalog-pb-name]')
    await pg.fill('[data-testid=catalog-pb-name]', 'Flow playbook')
    await pg.locator('[data-testid=catalog-pb-step-en]').nth(0).fill('First step'); await pg.locator('[data-testid=catalog-pb-step-due]').nth(0).fill('2')
    await pg.click('[data-testid=catalog-pb-step-add]')
    await pg.locator('[data-testid=catalog-pb-step-en]').nth(1).fill('Second step'); await pg.locator('[data-testid=catalog-pb-step-es]').nth(1).fill('Segundo paso'); await pg.locator('[data-testid=catalog-pb-step-due]').nth(1).fill('5')
    await pg.fill('[data-testid=catalog-pb-welcome]', 'Hello {{name}}, welcome to {{company}}.')
    await pg.click('[data-testid=catalog-pb-save]'); await pg.wait_for_timeout(400)
    s = await state(pg, 'practice'); pb = next((p for p in s['playbooks'] if p['name'] == 'Flow playbook'), None)
    record(run, 'playbook created with its steps in both languages', pb is not None and [(x['title']['en'], x['title']['es'], x['dueIn']) for x in pb['steps']] == [('First step', 'First step', 2), ('Second step', 'Segundo paso', 5)] and pb.get('welcome', '').startswith('Hello'), pb and pb['steps'])

    # C5 a large catalog: 150 services, 250 tiers
    await patch(pg, 'practice', """
      const cats = ['tax', 'bookkeeping', 'payroll', 'formation', 'licensing', 'advisory', 'other', 'Sample group A', 'Sample group B'];
      const units = ['flat', 'hour', 'month', 'quarter', 'year'];
      d.__keep = d.catalog; d.catalog = [];
      let tiers = 0;
      for (let i = 0; i < 150; i++) {
        const n = i < 100 ? 2 : 1;   // 100 services with two tiers, 50 with one: 250 tiers
        const t = []; for (let k = 0; k < n; k++) { tiers++; t.push({ id: 'g' + i + '-t' + k, name: 'Sample tier ' + (k + 1), price: 40 + ((i * 7 + k * 13) % 90) * 5, unit: units[(i + k) % 5], ...(i % 10 === 0 ? { externalIds: { square: 'SAMPLE-VAR-' + i + '-' + k } } : {}) }); }
        d.catalog.push({ id: 'g' + i, name: 'Generated sample service ' + String(i + 1).padStart(3, '0'), category: cats[i % cats.length], active: i % 15 !== 14, tiers: t, code: 'GEN-' + i,
          i18n: { en: { name: 'Generated sample service ' + String(i + 1).padStart(3, '0') }, es: { name: 'Servicio de ejemplo generado ' + String(i + 1).padStart(3, '0') } },
          ...(i % 3 === 0 ? { repeat: 'monthly' } : {}), ...(i % 10 === 0 ? { externalIds: { square: 'SAMPLE-ITEM-' + i } } : {}) });
      }
    """)
    t0 = time.time(); await goto(pg, '/catalog'); took = time.time() - t0
    s = await state(pg, 'practice')
    n_active = len([x for x in s['catalog'] if x['active']]); n_tiers = sum(len(x['tiers']) for x in s['catalog'])
    first = await pg.locator('tr[data-service]').count(); groups = await pg.locator('[data-testid=catalog-group]').count()
    record(run, 'large catalog: 150 services and 250 tiers', len(s['catalog']) == 150 and n_tiers == 250, [len(s['catalog']), n_tiers])
    record(run, 'large catalog: opens as an index, every category with its count and the first one open', groups == 9 and 0 < first < n_active, [groups, first])
    await pg.click('[data-testid=catalog-fold-all]'); await pg.wait_for_timeout(300)
    rows = await pg.locator('tr[data-service]').count()
    record(run, 'large catalog: every active service is listed once the categories are open', rows == n_active, [rows, n_active])
    record(run, 'large catalog: the page opens in under 3 seconds', took < 3, round(took, 2))
    await text_ok(pg, run, 'large catalog')
    t0 = time.time(); await pg.fill('.catalog-filters input[type=search]', 'service 137'); await pg.wait_for_function("() => document.querySelectorAll('tr[data-service]').length === 1", timeout=3000); typed = time.time() - t0
    record(run, 'large catalog: search narrows to one service quickly', typed < 1.5, round(typed, 2))
    await pg.fill('.catalog-filters input[type=search]', '')
    await pg.click('[data-testid=catalog-fold-all]'); await pg.wait_for_timeout(200)
    await pg.locator('[data-testid=catalog-group]').first.click(); await pg.wait_for_timeout(200)
    record(run, 'a category folds', await pg.locator('tr[data-service]').count() < n_active)
    await pg.locator('[data-testid=catalog-group]').first.click()
    await goto(pg, '/catalog/g0')
    chips = await pg.locator('.catalog-chip').count()
    record(run, 'ids of connected systems show as read-only chips', chips >= 2 and await pg.locator('.catalog-chip input').count() == 0, chips)
    await pg.click('[data-testid=catalog-edit]'); await pg.wait_for_selector('[data-testid=catalog-f-tier-remove]')
    record(run, 'a tier linked to another system cannot be removed', await pg.locator('[data-testid=catalog-f-tier-remove]').first.is_disabled())
    await pg.keyboard.press('Escape')
    # export, then import the same file with one price changed and one service added
    await goto(pg, '/catalog')
    await pg.click('.catalog-filters .seg button:nth-child(3)'); await pg.wait_for_timeout(200)
    async with pg.expect_download(timeout=15000) as dl:
        await pg.click('[data-testid=catalog-export]')
    d = await dl.value; csv = open(await d.path(), 'rb').read().decode('utf-8-sig')
    lines = [l for l in csv.split('\r\n') if l]
    record(run, 'export: a CSV with one line per tier', d.suggested_filename.endswith('.csv') and len(lines) == 251 and lines[0].startswith('category,service,service_es'), [d.suggested_filename, len(lines)])
    record(run, 'export: ids of connected systems are in the file for reference', 'square=SAMPLE-ITEM-0' in csv)
    changed = lines[:]
    cells = changed[1].split(','); cells[9] = '777.25'; changed[1] = ','.join(cells)
    changed.append('"Sample group C",Imported sample service,Servicio de ejemplo importado,,,IMP-1,quarterly,yes,Standard,"$1,100",quarter,From the file,,,,')
    changed.append(',,,,,,,,Nameless,10,flat,,,,,')
    await pg.click('[data-testid=catalog-import]'); await pg.wait_for_selector('[data-testid=catalog-import-file]')
    await pg.set_input_files('[data-testid=catalog-import-file]', {'name': 'services.csv', 'mimeType': 'text/csv', 'buffer': ('﻿' + '\r\n'.join(changed) + '\r\n').encode('utf-8')})
    await pg.wait_for_selector('[data-testid=catalog-import-plan]')
    plan = await pg.inner_text('[data-testid=catalog-import-plan]')
    before = await state(pg, 'practice')
    record(run, 'import: the preview counts new, changed and skipped lines and changes nothing yet', re.search(r'\b1\b', plan) is not None and len(before['catalog']) == 150 and before['catalog'][0]['tiers'][0]['price'] != 777.25, plan[:200])
    await pg.click('[data-testid=catalog-import-apply]'); await pg.wait_for_timeout(500)
    s = await state(pg, 'practice'); imp = next((x for x in s['catalog'] if x.get('code') == 'IMP-1'), None)
    record(run, 'import: one service added, one price changed, nothing removed, ids untouched',
           len(s['catalog']) == 151 and imp is not None and imp['tiers'][0]['price'] == 1100 and imp['tiers'][0]['unit'] == 'quarter' and imp.get('repeat') == 'quarterly' and imp['i18n']['es']['name'] == 'Servicio de ejemplo importado'
           and by(s['catalog'], 'g0')['tiers'][0]['price'] == 777.25 and by(s['catalog'], 'g0')['tiers'][0]['id'] == 'g0-t0' and by(s['catalog'], 'g0')['externalIds'] == {'square': 'SAMPLE-ITEM-0'} and not imp.get('externalIds'), imp)
    # back to the sample catalog for the rest of the flow
    await patch(pg, 'practice', "d.catalog = d.__keep; delete d.__keep;")

    # E1 create an engagement from a service and a tier
    await goto(pg, '/jobs'); await text_ok(pg, run, 'engagement list')
    n_jobs = len((await state(pg, 'practice'))['jobs'])
    await pg.click('[data-testid=jobs-new]'); await pg.wait_for_selector('[data-testid=jobs-f-service]')
    record(run, 'engagement form: no work address, has period and office', await pg.locator('[data-testid=jobs-f-address]').count() == 0 and await pg.locator('[data-testid=jobs-f-period]').count() == 1 and await pg.locator('[data-testid=jobs-f-office]').count() == 1)
    await pg.select_option('[data-testid=jobs-f-client]', 'pc3')
    await pg.select_option('[data-testid=jobs-f-service]', 's-1040'); await pg.wait_for_timeout(150)
    name1 = await pg.input_value('[data-testid=jobs-f-name]'); price1 = await pg.input_value('[data-testid=jobs-f-price]')
    await pg.select_option('[data-testid=jobs-f-tier]', 's-1040-t2'); await pg.wait_for_timeout(150)
    price2 = await pg.input_value('[data-testid=jobs-f-price]'); period = await pg.input_value('[data-testid=jobs-f-period]')
    rep = await pg.locator('[data-testid=jobs-f-repeat] button[aria-pressed=true]').count()
    record(run, 'picking a service and a tier fills in name, price, rhythm and period', bool(name1) and price1 == '180' and price2 == '320' and period == str(time.localtime().tm_year) and rep == 1, [name1, price1, price2, period])
    await pg.fill('[data-testid=jobs-f-price]', '300'); await pg.fill('[data-testid=jobs-f-period]', '2025')
    await pg.select_option('[data-testid=jobs-f-status]', 'progress')
    await pg.click('[data-testid=jobs-save]'); await pg.wait_for_timeout(600)
    s = await state(pg, 'practice'); job = s['jobs'][0]
    record(run, 'engagement created: service, tier, overridden price, period, office and person of the client', len(s['jobs']) == n_jobs + 1 and job['serviceId'] == 's-1040' and job['tierId'] == 's-1040-t2' and job['price'] == 300 and job['period'] == '2025' and job['repeat'] == 'yearly' and job.get('unit') == 'flat' and job.get('officeId') == 'o2' and job['managerId'] == 'u4', {k: job.get(k) for k in ['serviceId', 'tierId', 'price', 'period', 'repeat', 'unit', 'officeId', 'managerId']})
    jid = job['id']
    pbt = [t for t in s['tasks'] if t.get('jobId') == jid and (t.get('auto') or '').startswith('playbook:pb-return:' + jid)]
    record(run, 'the playbook of the service created its tasks once', len(pbt) == 5 and len(set(t['auto'] for t in pbt)) == 5, len(pbt))
    record(run, 'the engagement page opened', f'/jobs/{jid}' in pg.url, pg.url)
    tabs = await pg.locator('[role=tab]').evaluate_all('els => els.map(e => e.dataset.testid)')
    record(run, 'engagement tabs: tasks, documents, appointments, messages, notes, billing, activity and no crew', tabs == ['jobs-tab-overview', 'jobs-tab-tasks', 'jobs-tab-documents', 'jobs-tab-appointments', 'jobs-tab-messages', 'jobs-tab-log', 'jobs-tab-money', 'jobs-tab-activity'], tabs)
    body = await text_ok(pg, run, 'engagement page')
    for tab in ['tasks', 'documents', 'appointments', 'messages', 'log', 'money', 'activity']:
        await goto(pg, f'/jobs/{jid}/{tab}'); await text_ok(pg, run, f'engagement tab {tab}')
    await goto(pg, f'/jobs/{jid}/tasks')
    record(run, 'tasks tab shows the playbook tasks and its progress', await pg.locator('[data-testid=jobs-tasks-open] .item').count() == 5 and await pg.locator('[data-testid=jobs-playbook]').count() == 1)
    # E2 billing: agreed price, received, balance
    await goto(pg, f'/jobs/{jid}/money')
    bill = await pg.inner_text('[data-testid=jobs-billing]')
    record(run, 'billing shows agreed price, received and balance', '$300' in bill and '$0.00' in bill and '$300.00' in bill, bill.replace('\n', ' | '))
    await pg.click('[data-testid=jobs-record-payment]'); await pg.locator('.modal input[type=number]').first.fill('125.50'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(400)
    bill = await pg.inner_text('[data-testid=jobs-billing]'); s = await state(pg, 'practice'); job = by(s['jobs'], jid)
    record(run, 'a partial payment is recorded to the cent and the balance follows', sum(r['amount'] for r in job['received']) == 125.5 and '$125.50' in bill and '$174.50' in bill, bill.replace('\n', ' | '))
    # E3 a repeating engagement rolls forward when it is completed
    before = await state(pg, 'practice'); pe1 = by(before['jobs'], 'pe1')
    await goto(pg, '/jobs/pe1'); await pg.select_option('[data-testid=jobs-status]', 'done'); await pg.wait_for_timeout(600)
    s = await state(pg, 'practice'); nxt = next((j for j in s['jobs'] if j.get('parentId') == 'pe1'), None)
    record(run, 'completing a monthly engagement creates the next period, pointing back', nxt is not None and nxt['status'] == 'progress' and nxt['price'] == pe1['price'] and nxt['serviceId'] == pe1['serviceId'] and nxt['period'] != pe1['period'] and nxt['start'] > pe1['start'] and nxt['received'] == [], nxt and {k: nxt.get(k) for k in ['period', 'start', 'end', 'status', 'price']})
    record(run, 'the page says so and links to the next period', await pg.locator('[data-testid=jobs-auto-next]').count() == 1)
    await pg.select_option('[data-testid=jobs-status]', 'progress'); await pg.wait_for_timeout(300); await pg.select_option('[data-testid=jobs-status]', 'done'); await pg.wait_for_timeout(500)
    s = await state(pg, 'practice')
    record(run, 'completing it again does not create a second next period', len([j for j in s['jobs'] if j.get('parentId') == 'pe1']) == 1)
    if nxt:
        await goto(pg, f"/jobs/{nxt['id']}")
        record(run, 'the next period links back to the one before', await pg.locator('[data-testid=jobs-prev-period]').count() == 1)
        pbn = [t for t in s['tasks'] if t.get('jobId') == nxt['id'] and (t.get('auto') or '').startswith('playbook:')]
        record(run, 'the playbook started for the new period', len(pbn) == len(by(s['playbooks'], 'pb-monthly')['steps']), len(pbn))

    # W1 winning a lead: client, one engagement per service, playbook, welcome draft, kickoff task, history
    s = await state(pg, 'practice'); lead = by(s['leads'], 'pl2')
    n_clients = len(s['clients']); n_jobs = len(s['jobs'])
    await goto(pg, '/leads/pl2'); await pg.click('[data-testid=leads-convert]'); await confirm(pg); await pg.wait_for_timeout(700)
    s = await state(pg, 'practice'); lead = by(s['leads'], 'pl2')
    won = [j for j in s['jobs'] if j.get('leadId') == 'pl2']
    record(run, 'won lead: a client and one engagement per service asked about', len(s['clients']) == n_clients + 1 and sorted(j['serviceId'] for j in won) == sorted(lead['serviceIds']) and len(s['jobs']) == n_jobs + len(lead['serviceIds']), [len(won), lead.get('serviceIds')])
    books = next((j for j in won if j['serviceId'] == 's-books'), None)
    if books:
        tier = by(by(s['catalog'], 's-books')['tiers'], books['tierId'])
        record(run, 'won lead: each engagement at the price of its tier, for the same client and person', all(j['price'] == by(by(s['catalog'], j['serviceId'])['tiers'], j['tierId'])['price'] and j['clientId'] == lead['clientId'] and j['managerId'] == won[0]['managerId'] for j in won), [(j['serviceId'], j['price']) for j in won])
        pbt = [t for t in s['tasks'] if t.get('jobId') == books['id'] and (t.get('auto') or '').startswith('playbook:pb-monthly:')]
        record(run, 'won lead: the playbook ran once for the engagement', len(pbt) == len(by(s['playbooks'], 'pb-monthly')['steps']), len(pbt))
        kick = [t for t in s['tasks'] if (t.get('auto') or '') == 'kickoff-appt:pl2']
        record(run, 'won lead: a task to schedule the kickoff appointment, and no appointment booked', len(kick) == 1 and kick[0]['clientId'] == lead['clientId'] and not any(a.get('leadId') == 'pl2' or a.get('clientId') == lead['clientId'] for a in s.get('appointments', [])), kick)
        welcome = [m for m in s['messages'] if (m.get('auto') or '') in ['lead-won:' + j['id'] for j in won]]
        record(run, 'won lead: one welcome message, a draft, nothing sent', len([m for m in welcome if m.get('auto') == 'lead-won:' + books['id']]) <= 1 and len(welcome) >= 1 and all(m['status'] == 'draft' for m in welcome), [(m.get('auto'), m['status']) for m in welcome])
        docs = [x for x in s['docs'] if x.get('jobId') in [j['id'] for j in won]]
        pending = next((a for a in s['activity'] if a['kind'] == 'workflow.docsPending' and a['ref']['id'] == 'pl2'), None)
        listed = sum(len(by(s['catalog'], j['serviceId']).get('docKinds') or []) for j in won)
        made = len([x for x in docs if x['kind'] in ('engagement_letter', 'service_order', 'service_agreement')])
        record(run, 'won lead: every listed document is prepared, or the history says it is still to prepare', made + (pending['params']['n'] if pending else 0) == listed and len(set((x['jobId'], x['kind']) for x in docs)) == len(docs), [made, pending and pending['params'], listed])
        record(run, 'won lead: the history has the workflow line', any(a['kind'] == 'workflow.won' and a['ref']['id'] == 'pl2' for a in s['activity']))
        await goto(pg, f"/clients/{lead['clientId']}/activity"); await text_ok(pg, run, 'client history after the win')
        await goto(pg, f"/clients/{lead['clientId']}/engagements")
        record(run, 'client tab lists the new engagements', await pg.locator('[data-testid=jobs-client-table] tbody tr').count() == len(won))
    # winning it again changes nothing
    counts = [len(s[k]) for k in ['clients', 'jobs', 'tasks', 'docs', 'messages']]
    await goto(pg, '/leads/pl2')
    if await pg.locator('[data-testid=leads-convert]').count():
        await pg.click('[data-testid=leads-convert]'); await pg.wait_for_timeout(300)
        if await pg.locator('.modal [data-autofocus]').count(): await confirm(pg)
    s = await state(pg, 'practice')
    record(run, 'a won lead cannot be converted twice', [len(s[k]) for k in ['clients', 'jobs', 'tasks', 'docs', 'messages']] == counts)

    # O1 opportunities
    await goto(pg, '/opportunities'); await text_ok(pg, run, 'opportunities')
    s = await state(pg, 'practice')
    open_now = [o for o in s['opportunities'] if o['status'] == 'open' and not o.get('followUp')]
    record(run, 'opportunities: the open ones are listed', await pg.locator('[data-testid=opp-table] tr[data-opp]').count() == len(open_now), len(open_now))
    record(run, 'the rule for individuals found the client nobody had been offered a session', any(o['clientId'] == 'pc5' and o['serviceId'] == 's-advisory' for o in s['opportunities']))
    record(run, 'no duplicate opportunity for a client and service', len(set((o['clientId'], o['serviceId']) for o in s['opportunities'])) == len(s['opportunities']))
    await pg.click('tr[data-opp=op1] [data-testid=opp-contacted]'); await pg.wait_for_timeout(300)
    s = await state(pg, 'practice'); record(run, 'mark contacted', by(s['opportunities'], 'op1')['status'] == 'contacted')
    await pg.click('tr[data-opp=op3] [data-testid=opp-more]'); await pg.click('[data-testid=opp-dismiss]'); await pg.wait_for_selector('[data-testid=opp-dismiss-save]')
    await pg.fill('[data-testid=opp-dismiss-text]', 'Their accountant runs payroll'); await pg.click('[data-testid=opp-dismiss-save]'); await pg.wait_for_timeout(300)
    s = await state(pg, 'practice'); o3 = by(s['opportunities'], 'op3')
    record(run, 'dismiss keeps the reason', o3['status'] == 'dismissed' and 'Their accountant runs payroll' in (o3.get('dismissedReason') or ''), o3)
    await pg.click('[data-testid=opp-run]'); await pg.wait_for_timeout(300)
    s2 = await state(pg, 'practice')
    record(run, 'running the rules again does not suggest a dismissed service', len(s2['opportunities']) == len(s['opportunities']))
    # to a lead in the pipeline
    await pg.click('.opportunities-bar .seg button:nth-child(2)'); await pg.wait_for_timeout(200)
    n_leads = len(s2['leads'])
    await pg.click('tr[data-opp=op1] [data-testid=opp-more]'); await pg.click('[data-testid=opp-to-lead]'); await pg.wait_for_timeout(600)
    s = await state(pg, 'practice'); o1 = by(s['opportunities'], 'op1'); l = by(s['leads'], o1.get('leadId'))
    record(run, 'convert to a lead: linked, for the same client and service', len(s['leads']) == n_leads + 1 and l is not None and l.get('clientId') == 'pc7' and l.get('serviceIds') == ['s-books'] and f"/leads/{l['id']}" in pg.url, o1)
    # straight to an engagement, picking the tier
    await goto(pg, '/opportunities'); await pg.click('.opportunities-bar .seg button:nth-child(2)'); await pg.wait_for_timeout(200)
    n_jobs = len(s['jobs'])
    await pg.click('tr[data-opp=op2] [data-testid=opp-to-job]'); await pg.wait_for_selector('[data-testid=opp-tier-save]')
    await pg.locator('.modal input[type=radio]').nth(1).check(); await pg.click('[data-testid=opp-tier-save]'); await pg.wait_for_timeout(600)
    s = await state(pg, 'practice'); o2 = by(s['opportunities'], 'op2'); j = by(s['jobs'], o2.get('jobId'))
    record(run, 'convert to an engagement: won, at the tier picked', len(s['jobs']) == n_jobs + 1 and o2['status'] == 'won' and j is not None and j['serviceId'] == 's-wageforms' and j['tierId'] == 's-wageforms-t2' and j['price'] == 260 and j['clientId'] == 'pc6', j and {k: j.get(k) for k in ['serviceId', 'tierId', 'price']})
    # add one by hand, twice
    await goto(pg, '/opportunities'); await pg.click('[data-testid=opp-add]'); await pg.wait_for_selector('[data-testid=opp-add-client]')
    await pg.select_option('[data-testid=opp-add-client]', 'pc9'); await pg.select_option('[data-testid=opp-add-service]', 's-license'); await pg.fill('[data-testid=opp-add-note]', 'Asked about the town license'); await pg.click('[data-testid=opp-add-save]'); await pg.wait_for_timeout(300)
    await pg.click('[data-testid=opp-add]'); await pg.select_option('[data-testid=opp-add-client]', 'pc9'); await pg.select_option('[data-testid=opp-add-service]', 's-license'); await pg.click('[data-testid=opp-add-save]'); await pg.wait_for_timeout(300)
    s = await state(pg, 'practice'); mine = [o for o in s['opportunities'] if o['clientId'] == 'pc9' and o['serviceId'] == 's-license']
    record(run, 'an opportunity added by hand is not created twice', len(mine) == 1 and mine[0]['value'] == 95 and mine[0]['by'] == 'u1', mine)
    # R1 rules
    await goto(pg, '/opportunities/rules'); await text_ok(pg, run, 'cross-sell rules')
    matches = await pg.locator('[data-testid=opp-rule-match]').count()
    record(run, 'every sample rule says how many clients it applies to', matches == len(s['crossSell']), matches)
    await pg.click('[data-testid=opp-rule-new]'); await pg.wait_for_selector('[data-testid=opp-rule-name]')
    await pg.fill('[data-testid=opp-rule-name]', 'Flow rule'); await pg.select_option('[data-testid=opp-rule-when]', 's-salestax'); await pg.select_option('[data-testid=opp-rule-suggest]', 's-books'); await pg.select_option('[data-testid=opp-rule-kind]', 'business')
    await pg.fill('[data-testid=opp-rule-note]', 'Sales records are half of the books already.')
    await pg.click('[data-testid=opp-rule-save]'); await pg.wait_for_timeout(400)
    s = await state(pg, 'practice'); rule = next((r for r in s['crossSell'] if r['name'] == 'Flow rule'), None)
    record(run, 'rule created as data', rule is not None and rule['whenServiceIds'] == ['s-salestax'] and rule['suggestServiceId'] == 's-books' and rule.get('clientKind') == 'business', rule)
    await goto(pg, '/opportunities'); n = len(s['opportunities']); await pg.click('[data-testid=opp-run]'); await pg.wait_for_timeout(400)
    s = await state(pg, 'practice'); new = [o for o in s['opportunities'] if o.get('ruleId') == (rule or {}).get('id')]
    record(run, 'the new rule finds the sales tax client and carries the talking points', len(new) == 1 and new[0]['clientId'] == 'pc9' and new[0]['note'].startswith('Sales records') and new[0]['value'] == 220 and len(s['opportunities']) == n + 1, new)
    await goto(pg, '/clients/pc9/opportunities'); await text_ok(pg, run, 'client opportunities tab')
    record(run, 'client tab lists the client\'s opportunities', await pg.locator('[data-testid=opp-client-list] [data-opp]').count() == len([o for o in s['opportunities'] if o['clientId'] == 'pc9']))

    # S1 search
    await pg.click('[data-testid=global-search]'); await pg.fill('[data-testid=search-input]', 'TAX-IND'); await pg.wait_for_timeout(300)
    record(run, 'the command palette finds a service by its code', await pg.locator('.palette .hit').count() >= 1)
    await pg.keyboard.press('Escape')

    # A1 roles: read only looks and changes nothing; a person of another office does not see that office's engagements
    await view_as(pg, 'readonly')
    await goto(pg, '/catalog')
    record(run, 'read only: catalog without new, import or edit', await pg.locator('[data-testid=catalog-new]').count() == 0 and await pg.locator('[data-testid=catalog-import]').count() == 0 and await pg.locator('tr[data-service]').count() > 0)
    await goto(pg, '/catalog/s-1040'); record(run, 'read only: a service without edit, duplicate or retire', await pg.locator('[data-testid=catalog-edit]').count() + await pg.locator('[data-testid=catalog-retire]').count() + await pg.locator('[data-testid=catalog-tier-up]').count() == 0)
    await goto(pg, '/catalog/playbooks'); record(run, 'read only: playbooks without new or edit', await pg.locator('[data-testid=catalog-pb-new]').count() + await pg.locator('[data-testid=catalog-pb-edit]').count() == 0)
    await goto(pg, '/opportunities'); record(run, 'read only: opportunities without actions', await pg.locator('[data-testid=opp-add]').count() + await pg.locator('[data-testid=opp-run]').count() + await pg.locator('[data-testid=opp-contacted]').count() + await pg.locator('[data-testid=opp-more]').count() == 0)
    await goto(pg, '/opportunities/rules'); record(run, 'read only: rules without new, edit or switch', await pg.locator('[data-testid=opp-rule-new]').count() + await pg.locator('[data-testid=opp-rule-edit]').count() + await pg.locator('[data-testid=opp-rule-active]').count() == 0)
    await goto(pg, '/jobs'); record(run, 'read only: engagements without new', await pg.locator('[data-testid=jobs-new]').count() == 0 and await pg.locator('[data-testid=jobs-table] tbody tr').count() > 0)
    await goto(pg, '/jobs/pe3'); record(run, 'read only: an engagement without edit or status control', await pg.locator('[data-testid=jobs-edit]').count() + await pg.locator('[data-testid=jobs-status]').count() == 0 and await pg.locator('[data-testid=jobs-tab-overview]').count() == 1)
    await view_as(pg, 'staff')
    await goto(pg, '/jobs')
    s = await state(pg, 'practice'); staff = next(u for u in s['users'] if u['role'] == 'staff' and u.get('active', True))
    hidden = [j['id'] for j in s['jobs'] if (by(s['clients'], j['clientId']) or {}).get('officeId') and by(s['clients'], j['clientId'])['officeId'] not in (staff.get('officeIds') or [])]
    shown = await pg.locator('[data-testid=jobs-table] tbody tr').evaluate_all('els => els.map(e => e.dataset.job)')
    record(run, 'office scope: engagements of another office are not listed', hidden and not set(hidden) & set(shown), [len(hidden), len(shown)])
    if hidden:
        await pg.goto(BASE + ROOT + f'/jobs/{hidden[0]}'); await pg.wait_for_timeout(700)
        record(run, 'office scope: such an engagement does not open', await pg.locator('[data-testid=jobs-status]').count() == 0 and await pg.locator('[data-testid=jobs-tab-overview]').count() == 0)
    await goto(pg, '/opportunities')
    rows = await pg.locator('[data-testid=opp-table] tr[data-opp]').evaluate_all('els => els.map(e => e.dataset.opp)')
    other = [o['id'] for o in s['opportunities'] if (by(s['clients'], o['clientId']) or {}).get('officeId') and by(s['clients'], o['clientId'])['officeId'] not in (staff.get('officeIds') or [])]
    record(run, 'office scope: opportunities of another office are not listed', not set(other) & set(rows), [other, rows])
    await view_as(pg, 'owner')
    record(run, 'no console errors during the flow', not errs, errs[:3])
    await ctx.close()

    # phone width: the main screens have no sideways scroll
    ctx, pg, errs = await open_workspace(browser, 'practice', 390, 844)
    for path in ['/catalog', '/catalog/s-1040', '/catalog/playbooks', '/jobs', '/jobs/pe3', '/jobs/pe3/money', '/opportunities', '/opportunities/rules', '/clients/pc6/opportunities', '/clients/pc6/engagements']:
        await goto(pg, path); await text_ok(pg, run, f'phone {path}')
    record(run, 'no console errors at phone width', not errs, errs[:3])
    await ctx.close()

# ---------------------------------------------------------------------------------------------------------------------
async def field(browser, pack):
    run = f'{pack}/{LANG}/{NS}'
    print('flow', run, flush=True)
    facts = {p['id']: p for p in json.load(open(os.path.join(HERE, '.pack-facts.json')))}[pack]
    ctx, pg, errs = await open_workspace(browser, pack)
    s0 = await state(pg, pack)
    record(run, 'the edition starts without a catalog', s0['catalog'] == [] and s0['playbooks'] == [] and s0['crossSell'] == [] and s0['opportunities'] == [])
    # F1 without a catalog the job form and the job page are what they were
    await goto(pg, '/jobs'); await pg.click('[data-testid=jobs-new]'); await pg.wait_for_selector('[data-testid=jobs-f-name]')
    record(run, 'job form without a catalog: no service, tier, period or office field; the address is there', sum([await pg.locator(f'[data-testid=jobs-f-{k}]').count() for k in ['service', 'tier', 'period', 'office', 'unit']]) == 0 and await pg.locator('[data-testid=jobs-f-address]').count() == 1)
    await pg.fill('[data-testid=jobs-f-name]', 'Flow test job'); await pg.fill('[data-testid=jobs-f-price]', '1500')
    await pg.click('[data-testid=jobs-save]'); await pg.wait_for_timeout(500)
    s = await state(pg, pack); job = s['jobs'][0]
    record(run, 'job created as before: no service, no period, no unit', job['name'] == 'Flow test job' and job['price'] == 1500 and not any(k in job for k in ['serviceId', 'tierId', 'period', 'unit', 'officeId', 'parentId']), sorted(job.keys()))
    tabs = await pg.locator('[role=tab]').evaluate_all('els => els.map(e => e.dataset.testid)')
    want = ['jobs-tab-overview'] + (['jobs-tab-team'] if facts.get('usesWorkers', True) else []) + ['jobs-tab-money', 'jobs-tab-tasks', 'jobs-tab-documents', 'jobs-tab-log', 'jobs-tab-activity']
    record(run, 'job tabs are the ones the edition always had', tabs == want, tabs)
    record(run, 'job page: no playbook, no service line', await pg.locator('[data-testid=jobs-playbook]').count() + await pg.locator('[data-testid=jobs-service-link]').count() == 0)
    await text_ok(pg, run, 'job page')
    # a repeating field job stays one job when it is completed
    n = len(s['jobs'])
    rep = next((j for j in s['jobs'] if j.get('repeat') and j['repeat'] != 'once' and j['status'] == 'progress'), None)
    if rep:
        await goto(pg, f"/jobs/{rep['id']}"); await pg.select_option('[data-testid=jobs-status]', 'done'); await pg.wait_for_timeout(500)
        s = await state(pg, pack)
        record(run, 'a repeating field job does not roll forward', len(s['jobs']) == n and not any(j.get('parentId') for j in s['jobs']))
    # F2 a company that starts a catalog: the screen is switched on for it, and the job form gains the service picker
    await patch(pg, pack, "d.config = { ...d.config, modules: { ...(d.config.modules || {}), catalog: true, opportunities: true } };")
    await goto(pg, '/catalog'); text = await text_ok(pg, run, 'catalog (empty)')
    record(run, 'empty catalog says what to do next', await pg.locator('.empty').count() == 1 and await pg.locator('[data-testid=catalog-new]').count() == 1)
    await pg.click('[data-testid=catalog-new]'); await pg.wait_for_selector('[data-testid=catalog-f-name]')
    await pg.fill('[data-testid=catalog-f-name]', 'Sample service A'); await pg.fill('[data-testid=catalog-f-name-es]', 'Servicio de ejemplo A')
    await pg.locator('[data-testid=catalog-f-tier-price]').nth(0).fill('480')
    cats = await pg.locator('[data-testid=catalog-f-category] option').evaluate_all('els => els.map(e => e.value)')
    record(run, 'categories offered are the edition\'s own service types', set(j['type'] for j in s0['jobs']) <= set(cats), cats[:4])
    await pg.click('[data-testid=catalog-save]'); await pg.wait_for_timeout(500)
    s = await state(pg, pack); svc = next((x for x in s['catalog'] if x['name'] == 'Sample service A'), None)
    record(run, 'service created in a field edition', svc is not None and svc['tiers'][0]['price'] == 480)
    text = await text_ok(pg, run, 'service page')
    words = ['engagement', 'encargo']
    record(run, 'the catalog speaks the edition\'s words', not any(w in text.lower() for w in words), [w for w in words if w in text.lower()])
    await goto(pg, '/jobs'); await pg.click('[data-testid=jobs-new]'); await pg.wait_for_selector('[data-testid=jobs-f-service]')
    record(run, 'job form with a catalog: the service picker appears, the address stays, no period or office', await pg.locator('[data-testid=jobs-f-address]').count() == 1 and await pg.locator('[data-testid=jobs-f-period]').count() + await pg.locator('[data-testid=jobs-f-office]').count() == 0)
    await pg.select_option('[data-testid=jobs-f-service]', svc['id']); await pg.wait_for_timeout(150)
    record(run, 'picking the service fills in the name and the price', await pg.input_value('[data-testid=jobs-f-name]') in ('Sample service A', 'Servicio de ejemplo A') and await pg.input_value('[data-testid=jobs-f-price]') == '480')
    await pg.click('[data-testid=jobs-save]'); await pg.wait_for_timeout(500)
    s = await state(pg, pack); job = s['jobs'][0]
    record(run, 'job created from the service', job.get('serviceId') == svc['id'] and job['price'] == 480 and job['type'] in [t for t in cats])
    text = await text_ok(pg, run, 'job page with a service')
    record(run, 'job page in the edition\'s words', not any(w in text.lower() for w in words), [w for w in words if w in text.lower()])
    await goto(pg, '/opportunities'); text = await text_ok(pg, run, 'opportunities (empty)')
    record(run, 'opportunities in the edition\'s words', not any(w in text.lower() for w in words))
    record(run, 'no console errors during the flow', not errs, errs[:3])
    await ctx.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        for pack in PACKS:
            try:
                if pack == 'practice': await practice(b)
                else: await field(b, pack)
            except Exception as e:
                record(pack, 'flow ran to the end', False, repr(e)[:300])
        await b.close()
    ok = sum(1 for r in RESULTS if r['ok']); bad = [r for r in RESULTS if not r['ok']]
    json.dump(RESULTS, open(os.path.join(HERE, f'.qa-catalog-{NS}-{LANG}.json'), 'w'), indent=1)
    print(f'checks passed: {ok} / {len(RESULTS)}')
    for r in bad: print('FAIL', r['run'], '|', r['check'], '|', r['detail'])
    sys.exit(1 if bad else 0)

asyncio.run(main())
