# End-to-end flows through the demo, per industry: lead to won job to paid invoice, tasks, documents (PDF and demo signing),
# roles, plan badges, language, search, notifications, tour, reset, industry switch, plus the sales pages and pricing numbers.
# Usage: python3 tests/qa_flows.py [industry[:lang[:size]] ...]   default: all eight in English on desktop, plus two Spanish runs.
import asyncio, json, os, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
FACTS = {p['id']: p for p in json.load(open(os.path.join(ROOT, '.pack-facts.json')))}
PRICING = json.load(open(os.path.join(ROOT, '..', 'config', 'vyntex-build-pricing.json')))
BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
RESULTS = []

def record(run, name, ok, detail=''):
    RESULTS.append({'run': run, 'check': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    if not ok: print(f'  FAIL [{run}] {name}: {detail}', flush=True)

async def new_page(browser, w, h):
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    pg = await ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:200]))
    await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    return ctx, pg, errs

async def state(pg):
    return await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); return { prefs: p, data: JSON.parse(localStorage.getItem('vyntex.demo.' + p.pack)) }; }")

async def confirm(pg):
    await pg.click('.modal [data-autofocus]')
    await pg.wait_for_timeout(250)

async def set_control(pg, testid, value, narrow):
    """View-as and plan live in the Demo data popover on narrow screens."""
    if narrow and not await pg.locator(f'[data-testid={testid}]').count():
        await pg.click('[data-testid=demo-controls]'); await pg.wait_for_timeout(150)
    await pg.select_option(f'[data-testid={testid}]', value)
    await pg.wait_for_timeout(350)

async def flow(browser, pack_id, lang, size):
    run = f'{pack_id}/{lang}/{size}'
    w, h = (1440, 900) if size == 'desktop' else (390, 844)
    narrow = w <= 1180
    pack = FACTS[pack_id]
    ctx, pg, errs = await new_page(browser, w, h)
    await pg.goto(f'{BASE}/demo?industry={pack_id}&lang={lang}')
    await pg.wait_for_selector('#main h1')
    s0 = (await state(pg))['data']
    n_leads, n_tasks = len(s0['leads']), len(s0['tasks'])
    record(run, 'sample data loaded in the right language', s0['seedLang'] == lang and s0['pack'] == pack_id, s0['seedLang'])
    record(run, 'messages prepared on a fresh demo', len(s0['messages']) >= 1, len(s0['messages']))

    # F1 new lead -> intake automation
    await pg.goto(BASE + '/demo/leads'); await pg.click('[data-testid=leads-new]')
    inputs = pg.locator('.modal input')
    await inputs.nth(0).fill('Quinn Tester'); await inputs.nth(2).fill('609-555-0199'); await inputs.nth(3).fill('quinn@example.com'); await inputs.nth(4).fill('1 Sample Way, Northfield, NJ')
    await pg.locator('.modal input[type=number]').first.fill('5000')
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(500)
    s = (await state(pg))['data']
    lead = next((l for l in s['leads'] if l['name'] == 'Quinn Tester'), None)
    record(run, 'lead created', lead is not None and len(s['leads']) == n_leads + 1)
    if not lead: await ctx.close(); return
    record(run, 'lead page opened', f"/demo/leads/{lead['id']}" in pg.url, pg.url)
    record(run, 'intake rule: owner, follow-up and call-back task', bool(lead['ownerId']) and bool(lead.get('followUp')) and any(t.get('auto') == 'lead-intake:' + lead['id'] for t in s['tasks']))
    record(run, 'automation run recorded', any(r['ruleId'] == 'lead-intake' for r in s['automation']['runs']))

    # F2 win the lead -> client, job, kickoff tasks, welcome email
    await pg.click('[data-testid=leads-convert]'); await confirm(pg); await pg.wait_for_timeout(500)
    s = (await state(pg))['data']
    lead = next(l for l in s['leads'] if l['name'] == 'Quinn Tester')
    job = next((j for j in s['jobs'] if j['id'] == lead.get('jobId')), None)
    record(run, 'won lead became a job and a client', lead['status'] == 'won' and job is not None and any(c['id'] == lead.get('clientId') for c in s['clients']))
    if not job: await ctx.close(); return
    jid = job['id']
    kick = [t for t in s['tasks'] if (t.get('auto') or '').startswith('lead-won:' + jid)]
    record(run, 'kickoff tasks from the industry pack', len(kick) >= 3, len(kick))
    record(run, 'welcome email prepared, not sent', any(m.get('auto') == 'lead-won:' + jid and m['status'] == 'draft' for m in s['messages']))
    record(run, 'job page opened', f'/demo/jobs/{jid}' in pg.url, pg.url)
    record(run, 'job carries the lead value', job['price'] == 5000, job['price'])

    # F3 start and complete the job
    await pg.goto(f'{BASE}/demo/jobs/{jid}'); await pg.wait_for_selector('[data-testid=jobs-status]')
    await pg.select_option('[data-testid=jobs-status]', 'progress'); await pg.wait_for_timeout(400)
    await pg.select_option('[data-testid=jobs-status]', 'done'); await pg.wait_for_timeout(500)
    s = (await state(pg))['data']
    job = next(j for j in s['jobs'] if j['id'] == jid)
    inv = next((d for d in s['docs'] if d['jobId'] == jid and d['kind'] == 'invoice'), None)
    record(run, 'job completed', job['status'] == 'done')
    record(run, 'invoice drafted on completion', inv is not None and inv['status'] == 'draft')
    record(run, 'closeout tasks added', len([t for t in s['tasks'] if (t.get('auto') or '').startswith('job-completed:' + jid)]) >= 2)
    record(run, 'started and completed emails prepared', all(any(m.get('auto') == f'{k}:{jid}' for m in s['messages']) for k in ['job-started', 'job-completed']))
    numbers = [d['number'] for d in s['docs']]
    record(run, 'document numbers are unique', len(numbers) == len(set(numbers)), [n for n in numbers if numbers.count(n) > 1][:3])

    # F4 record the payment -> balance zero, invoice paid
    await pg.goto(f'{BASE}/demo/jobs/{jid}/money'); await pg.click('[data-testid=jobs-record-payment]')
    await pg.locator('.modal input[type=number]').first.fill('6000'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(300)
    s = (await state(pg))['data']; job = next(j for j in s['jobs'] if j['id'] == jid)
    record(run, 'payment above the balance is refused', sum(r['amount'] for r in job['received']) == 0)
    await pg.locator('.modal input[type=number]').first.fill('5000'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(500)
    s = (await state(pg))['data']; job = next(j for j in s['jobs'] if j['id'] == jid)
    inv = next(d for d in s['docs'] if d['jobId'] == jid and d['kind'] == 'invoice')
    record(run, 'payment recorded', sum(r['amount'] for r in job['received']) == 5000)
    record(run, 'invoice marked paid by the rule', inv['status'] == 'paid', inv['status'])

    # F5 documents: PDF download, agreement, demo signature
    await pg.goto(f"{BASE}/demo/documents/{inv['id']}"); await pg.wait_for_selector('[data-testid=docs-pdf]')
    try:
        async with pg.expect_download(timeout=20000) as dl:
            await pg.click('[data-testid=docs-pdf]')
        d = await dl.value; path = await d.path(); size_b = os.path.getsize(path)
        head = open(path, 'rb').read(5)
        record(run, 'invoice PDF downloads', d.suggested_filename.endswith('.pdf') and head == b'%PDF-' and size_b > 1500, f'{d.suggested_filename} {size_b}')
    except Exception as e:
        record(run, 'invoice PDF downloads', False, e)
    await pg.goto(f'{BASE}/demo/jobs/{jid}/documents'); await pg.click('[data-testid=jobs-create-contract]'); await pg.wait_for_timeout(600)
    s = (await state(pg))['data']
    con = next((d for d in s['docs'] if d['jobId'] == jid and d['kind'] == 'contract'), None)
    record(run, 'agreement created from the job', con is not None and '/demo/documents/' in pg.url, pg.url)
    if con:
        body = await pg.inner_text('.paper')
        record(run, 'agreement names the sample company and client', pack['company'] in body and 'Quinn Tester' in body)
        await pg.click('[data-testid=docs-send]'); await pg.wait_for_timeout(300)
        if await pg.locator('.modal [data-testid=docs-send]').count(): await pg.locator('.modal [data-testid=docs-send]').click()
        await pg.wait_for_timeout(300)
        s = (await state(pg))['data']; con = next(d for d in s['docs'] if d['id'] == con['id'])
        record(run, 'sent for signature (demo)', (con.get('esign') or {}).get('status') == 'sent' and con['esign'].get('demo') is True, con.get('esign'))
        await pg.click('[data-testid=docs-sign-open]'); await pg.wait_for_selector('[data-testid=docs-sign-name]')
        await pg.click('[data-testid=docs-sign-submit]'); await pg.wait_for_timeout(200)
        s = (await state(pg))['data']; c2 = next(d for d in s['docs'] if d['id'] == con['id'])
        record(run, 'signing needs name, consent and signature', c2['esign']['status'] != 'signed')
        await pg.fill('[data-testid=docs-sign-name]', 'Quinn Tester'); await pg.check('[data-testid=docs-sign-consent]'); await pg.click('[data-testid=docs-sign-typed]')
        await pg.click('[data-testid=docs-sign-submit]'); await pg.wait_for_timeout(500)
        s = (await state(pg))['data']; c2 = next(d for d in s['docs'] if d['id'] == con['id'])
        record(run, 'signed in the demo, labelled as a demo', c2['esign']['status'] == 'signed' and c2['esign']['demo'] is True and bool(c2['esign'].get('signature')))

    # F6 tasks
    await pg.goto(BASE + '/demo/tasks'); await pg.click('[data-testid=tasks-new]')
    await pg.locator('.modal input').first.fill('Flow test task'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(300)
    s = (await state(pg))['data']
    record(run, 'task created', any(t['title'] == 'Flow test task' for t in s['tasks']))
    cols = await pg.locator('[data-testid=tasks-board] .kcol').count()
    record(run, 'task board has the five columns', cols == 5, cols)

    # F7 search and notifications
    await pg.click('[data-testid=global-search]'); await pg.fill('[data-testid=search-input]', 'Quinn'); await pg.wait_for_timeout(250)
    hits = await pg.locator('.palette .hit').count()
    record(run, 'global search finds the new records', hits >= 2, hits)
    await pg.keyboard.press('Escape')
    await pg.click('[data-testid=bell]'); await pg.wait_for_timeout(200)
    record(run, 'notifications list opens', await pg.locator('.pop .nrow').count() > 0)
    await pg.keyboard.press('Escape')

    # F8 plan badges follow the plan selector
    await pg.goto(BASE + '/demo/automations'); await pg.wait_for_selector('[data-testid=auto-try]')
    await set_control(pg, 'plan', '0', narrow); await pg.keyboard.press('Escape')
    low = await pg.locator('[data-testid=auto-plan-note]').count()
    await set_control(pg, 'plan', '2', narrow); await pg.keyboard.press('Escape')
    high = await pg.locator('[data-testid=auto-plan-note]').count()
    record(run, 'plan selector changes what is shown as included', low > 0 and high == 0, f'{low} -> {high}')

    # F9 roles
    await set_control(pg, 'viewas', 'staff', narrow); await pg.keyboard.press('Escape')
    await pg.goto(BASE + '/demo/payments'); await pg.wait_for_timeout(500)
    record(run, 'office staff cannot open Payments', await pg.locator('[data-testid^=payments-tab]').count() == 0)
    await pg.goto(f'{BASE}/demo/jobs/{jid}'); await pg.wait_for_timeout(600)
    txt = await pg.inner_text('#main')
    record(run, 'office staff sees no money on a job', '$' not in txt, txt[:80] if '$' in txt else '')
    s = await state(pg); wid = s['data']['workers'][0]['id']; wname = s['data']['workers'][0]['name']
    if narrow: await pg.goto(BASE + '/demo')
    await set_control(pg, 'viewas', 'worker:' + wid, narrow); await pg.keyboard.press('Escape')
    await pg.goto(BASE + '/demo/jobs'); await pg.wait_for_timeout(700)
    nav = await pg.locator('.nav a').count()
    others = [x['name'] for x in s['data']['workers'][1:] if x['name'].split(' ')[0] != wname.split(' ')[0]]
    ptxt = await pg.inner_text('#main')
    record(run, 'worker sees only the portal', nav == 1 and await pg.locator('[data-testid=jobs-table]').count() == 0, nav)
    record(run, 'portal hides other workers', not any(o in ptxt for o in others), [o for o in others if o in ptxt][:2])
    if narrow: await pg.goto(BASE + '/demo')
    await set_control(pg, 'viewas', 'owner', narrow); await pg.keyboard.press('Escape')

    # F10 language switch keeps the visitor's changes
    other = 'es' if lang == 'en' else 'en'
    await pg.goto(BASE + '/demo'); await pg.click(f'[data-testid=lang-{other}]'); await pg.wait_for_timeout(400)
    s = await state(pg)
    record(run, 'language switch keeps changes', s['prefs']['lang'] == other and any(l['name'] == 'Quinn Tester' for l in s['data']['leads']))
    if not narrow:
        side = await pg.inner_text('.nav')
        record(run, 'navigation follows the language', pack['words'][other]['dashboard'] in side and pack['words'][other]['jobs'] in side, side[:60])
    await pg.click(f'[data-testid=lang-{lang}]'); await pg.wait_for_timeout(300)

    # F11 guided tour, start to finish
    await pg.click('[data-testid=demo-controls]'); await pg.click('[data-testid=tour-start]'); await pg.wait_for_selector('[data-testid=tour-card]')
    seen = []
    for _ in range(14):
        seen.append(await pg.get_attribute('[data-testid=tour-card]', 'data-step'))
        if not await pg.locator('[data-testid=tour-next]').count(): break
        await pg.click('[data-testid=tour-next]'); await pg.wait_for_timeout(900)
    record(run, 'guided tour reaches the end', seen[0] == 'welcome' and seen[-1] == 'end' and len(seen) >= 8, seen)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
    record(run, 'tour closes with Esc', await pg.locator('[data-testid=tour-card]').count() == 0)

    # F12 reset
    await pg.goto(BASE + '/demo'); await pg.click('[data-testid=demo-controls]'); await pg.click('[data-testid=reset-demo]'); await confirm(pg); await pg.wait_for_timeout(500)
    s = (await state(pg))['data']
    record(run, 'reset restores the sample business', len(s['leads']) == n_leads and not any(l['name'] == 'Quinn Tester' for l in s['leads']) and s['touched'] is False, len(s['leads']))

    # F13 industry switch
    nxt = 'clean' if pack_id != 'clean' else 'events'
    await pg.select_option('[data-testid=industry]', nxt); await pg.wait_for_timeout(700)
    s = await state(pg)
    record(run, 'industry switch loads the other edition', s['prefs']['pack'] == nxt and s['data']['company']['name'] == FACTS[nxt]['company'])
    if not narrow:
        side = await pg.inner_text('.side-brand')
        record(run, 'product name follows the industry', FACTS[nxt]['product'] in side, side)
    record(run, 'no console errors during the flow', not errs, errs[:3])
    await ctx.close()

def usd(n):
    return '$' + format(n, ',')

async def sales(browser):
    run = 'sales'
    ctx, pg, errs = await new_page(browser, 1440, 900)
    # pricing numbers for every edition, both billing periods, against the pricing file
    await pg.goto(BASE + '/pricing'); await pg.wait_for_selector('[data-testid=pr-industry]')
    base_plans = PRICING['plans']; other = PRICING['other_industries']['plans']
    bad = []
    for pid, pack in FACTS.items():
        await pg.select_option('[data-testid=pr-industry]', pid); await pg.wait_for_timeout(150)
        plans = base_plans if pid == 'build' else other
        for billing in ['monthly', 'yearly']:
            await pg.click(f'[data-testid=pr-billing-{billing}]'); await pg.wait_for_timeout(100)
            for p in plans:
                price = (await pg.inner_text(f"[data-testid=pr-price-{p['id']}]")).strip()
                setup = (await pg.inner_text(f"[data-testid=pr-setup-{p['id']}]")).strip()
                name = (await pg.inner_text(f"[data-testid=pr-name-{p['id']}]")).strip()
                want = usd(p['monthly_usd'] if billing == 'monthly' else p['yearly_usd'])
                if want not in price: bad.append(f'{pid} {p["id"]} {billing}: {price} != {want}')
                if usd(p['setup_usd']) not in setup: bad.append(f'{pid} {p["id"]} setup: {setup}')
                if p['name'] not in name: bad.append(f'{pid} {p["id"]} name: {name}')
    record(run, 'every plan price, setup fee and plan name matches the pricing file (8 editions x 3 plans x 2 periods)', not bad, bad[:4])
    text = await pg.inner_text('body')
    portal = await pg.inner_text('[data-testid=pr-addon-client_portal]')
    record(run, 'client portal shows no price and says it is not built yet', '$' not in portal and 'ot built' in portal, portal[:120])
    record(run, 'pricing version shown', PRICING['version'] in text)
    record(run, 'no internal rules shown (Stripe Tax instruction)', 'Stripe Tax' not in text and 'Daysi' not in text)
    for a in PRICING['add_ons']:
        if 'price_usd' in a:
            row = await pg.inner_text(f"[data-testid=pr-addon-{a['id']}]")
            record(run, f"add-on price from the file: {a['id']}", usd(a['price_usd']) in row, row[:80])
    # request a demo: validation, honest result, working alternatives
    await pg.goto(BASE + '/request-demo'); await pg.wait_for_selector('[data-testid=rd-form]')
    await pg.click('[data-testid=rd-submit]'); await pg.wait_for_timeout(200)
    record(run, 'request form validates before sending', await pg.locator('[data-testid^=rd-error-]').count() >= 3)
    await pg.fill('[data-testid=rd-name]', 'Quinn Tester'); await pg.fill('[data-testid=rd-business]', 'Sample Test Co'); await pg.fill('[data-testid=rd-phone]', '609-555-0199'); await pg.fill('[data-testid=rd-email]', 'quinn@example.com')
    await pg.check('[data-testid=rd-consent]')
    await pg.set_extra_http_headers({'x-forwarded-for': '203.0.113.77'})
    await pg.click('[data-testid=rd-submit]'); await pg.wait_for_selector('[data-testid=rd-result]')
    st = await pg.get_attribute('[data-testid=rd-result]', 'data-state'); res = await pg.inner_text('[data-testid=rd-result]')
    record(run, 'without delivery configured the page says the request was not sent', st == 'unsent', st)
    mail = await pg.get_attribute('[data-testid=rd-alt-email]', 'href'); wa = await pg.get_attribute('[data-testid=rd-alt-whatsapp]', 'href'); tel = await pg.get_attribute('[data-testid=rd-alt-call]', 'href')
    record(run, 'alternatives use the official contact details', mail.startswith('mailto:info@vyntexusa.com') and '16097803218' in wa and '6097803218' in tel, f'{mail[:40]} {wa[:40]} {tel}')
    record(run, 'never the other phone number', '813-0633' not in await pg.inner_text('body') and '8130633' not in (wa + tel))
    # overview: industry switch and opening the demo in that edition
    await pg.goto(BASE + '/'); await pg.wait_for_selector('[data-testid=mk-industry-events]')
    await pg.click('[data-testid=mk-industry-events]'); await pg.wait_for_timeout(300)
    hero = await pg.inner_text('main')
    record(run, 'overview switches industry', 'VYNTEX EVENTS' in hero.upper().replace('\n', ' ') or 'EVENTS' in hero)
    await pg.click('[data-testid=mk-open-demo]'); await pg.wait_for_selector('.side-brand')
    record(run, 'demo opens in the chosen industry', 'VYNTEX EVENTS' in await pg.inner_text('.side-brand'))
    await pg.click('[data-testid=see-pricing]'); await pg.wait_for_selector('[data-testid=pr-back-demo]')
    await pg.click('[data-testid=pr-back-demo]'); await pg.wait_for_selector('.side-brand')
    record(run, 'pricing links back to the demo', '/demo' in pg.url)
    await pg.goto(BASE + '/no-such-page'); await pg.wait_for_timeout(600)
    record(run, 'unknown address shows a not-found notice', await pg.locator('[data-testid=mk-notfound]').count() == 1)
    record(run, 'no console errors on the sales pages', not errs, errs[:3])
    await ctx.close()

async def main():
    args = sys.argv[1:]
    runs = [tuple((a.split(':') + ['en', 'desktop'])[:3]) for a in args] if args else [(p, 'en', 'desktop') for p in FACTS] + [('clean', 'es', 'phone'), ('turnover', 'es', 'desktop'), ('build', 'es', 'phone')]
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        for pack_id, lang, size in runs:
            if pack_id == 'sales': continue
            print('flow', pack_id, lang, size, flush=True)
            try: await flow(b, pack_id, lang, size)
            except Exception as e: record(f'{pack_id}/{lang}/{size}', 'flow ran to the end', False, repr(e)[:300])
        if not args or any(a.startswith('sales') for a in args):
            print('sales pages', flush=True)
            try: await sales(b)
            except Exception as e: record('sales', 'flow ran to the end', False, repr(e)[:300])
        await b.close()
    ok = sum(1 for r in RESULTS if r['ok']); bad = [r for r in RESULTS if not r['ok']]
    json.dump(RESULTS, open(os.path.join(ROOT, '.qa-flows' + os.environ.get('QA_OUT', '') + '.json'), 'w'), indent=1)
    print(f'checks passed: {ok} / {len(RESULTS)}')
    for r in bad: print('FAIL', r['run'], '|', r['check'], '|', r['detail'])

asyncio.run(main())
