# End-to-end flows through the demo, per industry: lead to won job to paid invoice, tasks, documents (PDF and demo signing),
# roles, plan badges, language, search, notifications, tour, reset, industry switch, plus the sales pages and pricing numbers.
# Usage: python3 tests/qa_flows.py [industry[:lang[:size]] ...]   default: the eight field editions in English on desktop, plus
# three Spanish runs. The flow is the field editions' flow (crews, worker portal, plans); the professional-services edition is
# covered by tests/qa_matrix.py and the unit tests, and the sales pages check that it shows no plan and no price.
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
        if not pack.get('priced', True):
            # an edition that is not in the pricing file: quoted on request, no plan and no price on the page
            quoted = await pg.locator('[data-testid=pr-quoted]').count()
            body = await pg.inner_text('main')
            record(run, f'{pid}: quoted on request, no plan and no price shown', quoted == 1 and '$' not in body and await pg.locator('[data-testid^=pr-price-]').count() == 0, body[:120])
            continue
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
    # back to an edition with plans: the checks below read the add-ons and the rules of the pricing file
    await pg.select_option('[data-testid=pr-industry]', 'build'); await pg.wait_for_timeout(200)
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
    # one word that could be a company address is a workspace (it asks to sign in); anything else unknown is not found
    await pg.goto(BASE + '/about/no-such-page'); await pg.wait_for_timeout(600)
    record(run, 'unknown address shows a not-found notice', await pg.locator('[data-testid=mk-notfound]').count() == 1)
    await pg.goto(BASE + '/no-such-company'); await pg.wait_for_timeout(600)
    record(run, 'a company address without a session asks to sign in', await pg.locator('[data-testid=auth-signin]').count() == 1 and await pg.locator('.side-brand').count() == 0)
    record(run, 'no console errors on the sales pages', not errs, errs[:3])
    await ctx.close()

# ---- documents and signatures (appended by the documents and e-signature module) ----------------------------------
# The professional-services edition, end to end: a document made from an unapproved starter cannot be sent; one made
# from an approved template is prepared (signers, boxes placed, moved, resized, deleted), sent, signed by two signers in
# order, and completed with a signed copy whose SHA-256 matches the record; decline, remind, void; uploads with versions;
# approving a template; what the read-only role and an associate may do; search. Run with: python3 tests/qa_flows.py docs
async def docs_flow(browser):
    import hashlib, tempfile
    run = 'practice/docs'
    OUT = tempfile.mkdtemp(prefix='vx-docs-')
    ctx, pg, errs = await new_page(browser, 1440, 900)
    rec = lambda name, ok, detail='': record(run, name, ok, detail)
    await pg.goto(f'{BASE}/demo?industry=practice&lang=en'); await pg.wait_for_selector('#main h1')
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.tourSeen = true; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")

    # 1 a document made from an unapproved starter cannot be sent
    await pg.goto(f'{BASE}/demo/documents/pd-el-pe6'); await pg.wait_for_selector('[data-testid=docs-unapproved]')
    rec('unapproved notice on the document', 'not approved yet' in (await pg.inner_text('[data-testid=docs-unapproved]')).lower() or 'aprobad' in (await pg.inner_text('[data-testid=docs-unapproved]')).lower())
    await pg.click('[data-testid=docs-env-start]'); await pg.wait_for_selector('[data-testid=esign-blockers]')
    blk = await pg.eval_on_selector_all('[data-testid=esign-blockers] li', 'els => els.map(e => e.dataset.blocker)')
    rec('unapproved template blocks sending', 'template_unapproved' in blk and await pg.is_disabled('[data-testid=esign-send]'), blk)

    # 2 new document from the approved sample template
    await pg.goto(f'{BASE}/demo/documents'); await pg.click('[data-testid=docs-new]'); await pg.wait_for_selector('[data-testid=docs-nd]')
    await pg.select_option('[data-testid=docs-nd-kind]', 'custom'); await pg.select_option('[data-testid=docs-nd-client]', 'pc8'); await pg.select_option('[data-testid=docs-nd-job]', 'pe9')
    await pg.click('[data-testid=docs-nd-create]'); await pg.wait_for_selector('.paper')
    s = (await state(pg))['data']; doc = s['docs'][0]
    rec('document created from the approved template', doc['kind'] == 'custom' and doc['clientId'] == 'pc8' and doc['templateId'] == 'pt-sample-en' and await pg.locator('[data-testid=docs-unapproved]').count() == 0, doc)
    rec('merge fields filled on the paper', 'Sunita Rao' in await pg.inner_text('.paper') and 'Sample Harbor Dental' in await pg.inner_text('.paper'))
    await pg.click('[data-testid=docs-env-start]'); await pg.wait_for_selector('[data-testid=esign-editor]', timeout=20000)
    await pg.wait_for_timeout(600)
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id'])
    rec('draft request with the signers the document asks for', [x.get('role') for x in env['signers']] == ['client', 'co_owner', 'firm'] and env['status'] == 'draft' and env.get('demo') is True, env['signers'])
    rec('boxes placed on the signature lines', len(env['fields']) >= 4 and all(0 <= f['x'] <= 1 and 0 <= f['y'] <= 1 for f in env['fields']), env['fields'])
    blk = await pg.eval_on_selector_all('[data-testid=esign-blockers] li', 'els => els.map(e => e.dataset.blocker)')
    rec('a signer without a name blocks sending', blk == ['bad_signer'], blk)
    # remove the co-owner, keep client and firm
    await pg.locator('[data-testid=esign-signer-remove]').nth(1).click(); await pg.wait_for_timeout(300)
    rec('ready once every signer is complete', await pg.locator('[data-testid=esign-ready]').count() == 1)
    # add a text box and a checkbox for the client, move one with the keyboard, make it optional
    n0 = len((await state(pg))['data']['envelopes'][0]['fields'])
    await pg.click('[data-testid=esign-tool-text]'); await pg.wait_for_timeout(200)
    for _ in range(4): await pg.keyboard.press('ArrowRight')
    await pg.keyboard.press('Shift+ArrowDown')
    await pg.fill('[data-testid=esign-props-label]', 'Title'); await pg.wait_for_timeout(100)
    await pg.click('[data-testid=esign-tool-checkbox]'); await pg.wait_for_timeout(200)
    await pg.uncheck('[data-testid=esign-props-required]')
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id'])
    txt = next(f for f in env['fields'] if f['type'] == 'text'); chk = next(f for f in env['fields'] if f['type'] == 'checkbox')
    rec('boxes added from the toolbar and moved with the keyboard', len(env['fields']) == n0 + 2 and txt.get('label') == 'Title' and abs(txt['x'] - (0.5 - txt['w'] / 2 + 0.02)) < 0.002 and chk['required'] is False, [txt, chk])
    # drag the checkbox with the mouse
    box = pg.locator(f".es-box[data-field='{chk['id']}']"); bb = await box.bounding_box()
    await pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await pg.mouse.down(); await pg.mouse.move(bb['x'] + 90, bb['y'] + 60, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(200)
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id']); chk2 = next(f for f in env['fields'] if f['id'] == chk['id'])
    rec('a box is moved by dragging', chk2['x'] > chk['x'] + 0.02 and chk2['y'] > chk['y'] + 0.02, [chk['x'], chk2['x'], chk['y'], chk2['y']])
    # resize from the corner
    await box.click(); hb = await box.locator('.es-handle').bounding_box()
    await pg.mouse.move(hb['x'] + 4, hb['y'] + 4); await pg.mouse.down(); await pg.mouse.move(hb['x'] + 40, hb['y'] + 4, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(200)
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id']); chk3 = next(f for f in env['fields'] if f['id'] == chk['id'])
    rec('a box is resized from its corner', chk3['w'] > chk2['w'] + 0.01, [chk2['w'], chk3['w']])
    # delete with the keyboard
    await box.focus(); await pg.keyboard.press('Delete'); await pg.wait_for_timeout(150)
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id'])
    rec('Delete removes the selected box', not any(f['id'] == chk['id'] for f in env['fields']))
    # send
    n_msgs = len((await state(pg))['data']['messages'])
    await pg.click('[data-testid=esign-send]'); await pg.wait_for_selector('[data-testid=esign-detail-signers]', timeout=20000)
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id']); d2 = next(d for d in s['docs'] if d['id'] == doc['id'])
    rec('sent: first signer has the link, second waits, nothing emailed', env['status'] == 'sent' and [x['status'] for x in env['signers']] == ['sent', 'waiting'] and d2['status'] == 'sent' and bool(env.get('source', {}).get('dataUrl')) and len(env['hashes']['original']) == 64, env['status'])
    rec('no message was created by sending', len(s['messages']) == n_msgs, len(s['messages']))
    rec('one signer page offered (the one whose turn it is)', await pg.locator('[data-testid=esign-open-signer]').count() == 1)
    # signer 1
    await pg.click('[data-testid=esign-open-signer]'); await pg.wait_for_selector('[data-testid=esign-sign]')
    await pg.click('[data-testid=esign-sign-continue]')
    rec('consent is required before the boxes', await pg.get_attribute('[data-testid=esign-sign]', 'data-step') == 'agree' and await pg.locator('[data-testid=esign-sign-error]').count() == 1)
    await pg.check('[data-testid=esign-sign-consent]'); await pg.click('[data-testid=esign-sign-continue]'); await pg.wait_for_selector('[data-testid=esign-sign-pages]')
    await pg.wait_for_timeout(500)
    rec('review is not offered while required boxes are empty', await pg.locator('[data-testid=esign-sign-review]').count() == 0 and await pg.locator('[data-testid=esign-sign-next]').count() == 1)
    await pg.click('[data-testid=esign-sign-signature]'); await pg.wait_for_selector('[data-testid=esign-pad]')
    await pg.click('[data-testid=esign-pad-done]'); await pg.wait_for_timeout(100)
    rec('an empty pad is refused', await pg.locator('[data-testid=esign-pad-error]').count() == 1)
    pad = await pg.locator('[data-testid=esign-pad]').bounding_box()
    await pg.mouse.move(pad['x'] + 30, pad['y'] + 80); await pg.mouse.down()
    for i in range(1, 12): await pg.mouse.move(pad['x'] + 30 + i * 18, pad['y'] + 80 + (25 if i % 2 else -25), steps=3)
    await pg.mouse.up()
    await pg.click('[data-testid=esign-pad-done]'); await pg.wait_for_timeout(200)
    await pg.fill('[data-testid=esign-sign-text]', 'Owner'); await pg.wait_for_timeout(100)
    await pg.click('[data-testid=esign-sign-review]'); await pg.wait_for_selector('[data-testid=esign-sign-finish]')
    await pg.click('[data-testid=esign-sign-finish]'); await pg.wait_for_selector('[data-testid=esign-sign-state]')
    st = await pg.get_attribute('[data-testid=esign-sign-state]', 'data-state')
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id'])
    rec('first signer signed, second let in', st == 'signed' and env['status'] == 'partly_signed' and [x['status'] for x in env['signers']] == ['signed', 'sent'] and env['signers'][0]['signature'].startswith('data:image/png') and bool(env['signers'][0].get('consentAt')), st)
    await pg.click('[data-testid=esign-sign-exit]'); await pg.wait_for_selector('[data-testid=esign-open-signer]')
    # signer 2 with a typed signature
    await pg.click('[data-testid=esign-open-signer]'); await pg.wait_for_selector('[data-testid=esign-sign]')
    await pg.check('[data-testid=esign-sign-consent]'); await pg.click('[data-testid=esign-sign-continue]'); await pg.wait_for_selector('[data-testid=esign-sign-pages]')
    await pg.click('[data-testid=esign-sign-signature]'); await pg.wait_for_selector('[data-testid=esign-pad]'); await pg.click('[data-testid=esign-pad-typed]'); await pg.click('[data-testid=esign-pad-done]')
    await pg.wait_for_timeout(300)
    await pg.click('[data-testid=esign-sign-review]'); await pg.click('[data-testid=esign-sign-finish]'); await pg.wait_for_selector('[data-testid=esign-sign-state][data-state=completed]')
    await pg.click('[data-testid=esign-sign-exit]'); await pg.wait_for_selector('[data-testid=esign-download-signed]', timeout=30000)
    s = (await state(pg))['data']; env = next(e for e in s['envelopes'] if e['docId'] == doc['id']); d2 = next(d for d in s['docs'] if d['id'] == doc['id'])
    rec('completed: document signed, signed copy stored as a new version with three fingerprints', env['status'] == 'completed' and d2['status'] == 'signed' and d2['versions'][-1].get('kind') == 'signed' and all(len(env['hashes'].get(k, '')) == 64 for k in ['original', 'signed', 'final']), env['hashes'])
    async with pg.expect_download(timeout=20000) as dl: await pg.click('[data-testid=esign-download-signed]')
    d = await dl.value; path = f'{OUT}/signed.pdf'; await d.save_as(path)
    rec('downloaded signed copy matches the fingerprint on record', hashlib.sha256(open(path, 'rb').read()).hexdigest() == env['hashes']['final'], d.suggested_filename)
    async with pg.expect_download(timeout=20000) as dl: await pg.click('[data-testid=esign-download-original]')
    d = await dl.value; await d.save_as(f'{OUT}/original.pdf')
    rec('the document as sent matches its fingerprint', hashlib.sha256(open(f'{OUT}/original.pdf', 'rb').read()).hexdigest() == env['hashes']['original'])

    # 3 seeded envelopes: waiting on the second signer; decline; the completed one builds its copy
    await pg.goto(f'{BASE}/demo/esign'); await pg.wait_for_selector('[data-testid=esign-table]')
    rows = await pg.locator('[data-testid=esign-table] tbody tr').count()
    rec('list shows the requests', rows >= 3, rows)
    await pg.goto(f'{BASE}/demo/esign/pv2'); await pg.wait_for_selector('[data-testid=esign-download-signed]', timeout=30000)
    s = (await state(pg))['data']; pv2 = next(e for e in s['envelopes'] if e['id'] == 'pv2')
    rec('the completed sample request builds its signed copy when opened', bool(pv2.get('signedFile')) and len(pv2['fields']) >= 2 and s['touched'] in (True, False))
    await pg.goto(f'{BASE}/demo/esign/pv1'); await pg.wait_for_selector('[data-testid=esign-remind]')
    await pg.click('[data-testid=esign-remind]'); await pg.wait_for_timeout(300)
    s = (await state(pg))['data']; pv1 = next(e for e in s['envelopes'] if e['id'] == 'pv1')
    rec('remind is recorded, nothing is sent', pv1['events'][-1]['kind'] == 'reminded' and not any(m.get('status') == 'sent' for m in s['messages']))
    await pg.click('[data-testid=esign-open-signer]'); await pg.wait_for_selector('[data-testid=esign-sign]')
    await pg.click('[data-testid=esign-sign-decline]'); await pg.fill('[data-testid=esign-sign-decline-reason]', 'Not the right version'); await pg.click('[data-testid=esign-sign-decline-confirm]')
    await pg.wait_for_selector('[data-testid=esign-sign-state][data-state=declined]')
    s = (await state(pg))['data']; pv1 = next(e for e in s['envelopes'] if e['id'] == 'pv1'); dd = next(d for d in s['docs'] if d['id'] == pv1['docId'])
    rec('decline closes the request with the reason, document back to draft', pv1['status'] == 'declined' and pv1['signers'][1].get('declineReason') == 'Not the right version' and dd['status'] == 'draft')

    # 4 upload a PDF, new version, send it for signature, void
    await pg.goto(f'{BASE}/demo/documents?new=1&kind=upload&client=pc2'); await pg.wait_for_selector('[data-testid=docs-nd-file]')
    await pg.set_input_files('[data-testid=docs-nd-file]', {'name': 'notes.exe', 'mimeType': 'application/octet-stream', 'buffer': b'MZ000'})
    await pg.click('[data-testid=docs-nd-create]'); await pg.wait_for_selector('[data-testid=docs-nd-error]')
    rec('a file of a kind that is not accepted is refused', True)
    await pg.set_input_files('[data-testid=docs-nd-file]', {'name': 'big.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-' + b'0' * 700000})
    await pg.click('[data-testid=docs-nd-create]'); await pg.wait_for_timeout(300)
    rec('a file over the limit is refused, with the limit', '600' in await pg.inner_text('[data-testid=docs-nd-error]'), await pg.inner_text('[data-testid=docs-nd-error]'))
    await pg.set_input_files('[data-testid=docs-nd-file]', f'{OUT}/original.pdf'); await pg.fill('[data-testid=docs-nd-folder]', 'Signed forms')
    await pg.click('[data-testid=docs-nd-create]'); await pg.wait_for_selector('[data-testid=docs-file-facts]')
    s = (await state(pg))['data']; up = s['docs'][0]
    rec('upload filed under the client with its folder', up['kind'] == 'upload' and up['clientId'] == 'pc2' and up.get('folder') == 'Signed forms' and len(up['versions']) == 1 and up['file']['mime'] == 'application/pdf', up.get('folder'))
    await pg.wait_for_timeout(800)
    await pg.set_input_files('[data-testid=docs-file-input]', f'{OUT}/signed.pdf'); await pg.wait_for_timeout(1200)
    s = (await state(pg))['data']; up = next(d for d in s['docs'] if d['id'] == up['id'])
    rec('a new upload is a new version, the old one stays', [v['v'] for v in up['versions']] == [1, 2] and up['file']['name'] == 'signed.pdf' and await pg.locator('[data-testid=docs-version-download]').count() == 2)
    async with pg.expect_download(timeout=20000) as dl: await pg.locator('[data-testid=docs-version-download]').nth(1).click()
    d = await dl.value; await d.save_as(f'{OUT}/v1.pdf')
    rec('the older version still downloads, unchanged', open(f'{OUT}/v1.pdf', 'rb').read() == open(f'{OUT}/original.pdf', 'rb').read())
    await pg.click('[data-testid=docs-env-start]'); await pg.wait_for_selector('[data-testid=esign-editor]', timeout=20000)
    mode = await pg.get_attribute('.es-page', 'data-mode'); n = await pg.locator('.es-page').count()
    rec('uploaded PDF: one sheet per page with the size read from the file', n == 2 and mode in ('viewer', 'blank'), f'{n} {mode}')
    await pg.select_option('[data-testid=esign-tool-page]', '0')
    await pg.click('[data-testid=esign-tool-signature]'); await pg.wait_for_timeout(200)
    await pg.fill('[data-testid=esign-props-y]', '80'); await pg.wait_for_timeout(200)
    await pg.click('[data-testid=esign-send]'); await pg.wait_for_selector('[data-testid=esign-detail-signers]', timeout=20000)
    s = (await state(pg))['data']; ev = s['envelopes'][0]
    rec('uploaded PDF sent as it is', ev['status'] == 'sent' and ev['source']['name'] == 'signed.pdf' and not ev.get('view') and len(ev['pages']) == 2 and abs(ev['fields'][0]['y'] - 0.8) < 0.001, ev['status'])
    await pg.click('[data-testid=esign-void]'); await pg.click('.modal [data-autofocus]'); await pg.wait_for_timeout(300)
    s = (await state(pg))['data']; ev = s['envelopes'][0]
    rec('void closes the request', ev['status'] == 'void' and next(d for d in s['docs'] if d['id'] == ev['docId'])['status'] == 'draft')

    # 5 settings: replace the placeholders of a starter, approve it, the document can then be prepared without the template blocker
    await pg.goto(f'{BASE}/demo/settings/documents'); await pg.wait_for_selector('[data-testid=docs-settings]')
    row = pg.locator('[data-tpl=starter-engagement_letter-en]')
    rec('a starter cannot be approved as it is', await row.locator('[data-testid=docs-tpl-approve]').is_disabled())
    await row.locator('[data-testid=docs-tpl-edit]').click(); await pg.wait_for_selector('[data-testid=docs-tpl-editor]')
    areas = pg.locator('[data-testid=docs-tpl-text]'); cnt = await areas.count()
    for i in range(cnt):
        v = await areas.nth(i).input_value()
        if '[' in v: await areas.nth(i).fill('Test wording typed by the reviewer.')
    await pg.click('[data-testid=docs-tpl-save]'); await pg.wait_for_timeout(300)
    await row.locator('[data-testid=docs-tpl-approve]').click(); await pg.wait_for_timeout(300)
    s = (await state(pg))['data']; tpl = next(t for t in s['templates'] if t['id'] == 'starter-engagement_letter-en')
    rec('edited and approved: who and when are recorded', tpl['approved'] is True and tpl['source'] == 'company' and tpl.get('approvedBy') == 'u1' and bool(tpl.get('approvedAt')), tpl.get('approvedBy'))
    await pg.goto(f'{BASE}/demo/documents/pd-el-pe6'); await pg.wait_for_selector('.paper')
    rec('the document no longer carries the notice', await pg.locator('[data-testid=docs-unapproved]').count() == 0 and 'Test wording typed by the reviewer.' in await pg.inner_text('.paper'))

    # 6 roles
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = 'readonly'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    await pg.goto(f'{BASE}/demo/esign'); await pg.wait_for_selector('[data-testid=esign-table]')
    rec('read only: no new request, no remind, no void', await pg.locator('[data-testid=esign-new]').count() == 0 and await pg.locator('[data-testid=esign-remind]').count() == 0 and await pg.locator('[data-testid=esign-void]').count() == 0)
    await pg.goto(f'{BASE}/demo/documents'); await pg.wait_for_selector('[data-testid=docs-table]')
    rec('read only: no new document', await pg.locator('[data-testid=docs-new]').count() == 0)
    await pg.goto(f'{BASE}/demo/documents/pd-up-pc7'); await pg.wait_for_selector('[data-testid=docs-file-facts]')
    rec('read only: file page has no upload or void, and still downloads', await pg.locator('[data-testid=docs-file-version]').count() == 0 and await pg.locator('[data-testid=docs-void]').count() == 0 and await pg.locator('[data-testid=docs-file-download]').count() == 1)
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = 'staff'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    await pg.goto(f'{BASE}/demo/settings/documents'); await pg.wait_for_timeout(700)
    rec('associate: no template settings', await pg.locator('[data-testid=docs-settings]').count() == 0)
    await pg.goto(f'{BASE}/demo/esign'); await pg.wait_for_selector('[data-testid=esign-table]')
    rec('associate: can start a request', await pg.locator('[data-testid=esign-new]').count() == 1)
    # 7 search
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = 'owner'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    await pg.goto(f'{BASE}/demo/esign'); await pg.wait_for_selector('[data-testid=esign-table]')
    await pg.click('[data-testid=global-search]'); await pg.fill('[data-testid=search-input]', 'VP-DOC-1002'); await pg.wait_for_timeout(300)
    txt = await pg.inner_text('.palette')
    rec('search finds the signature request', 'VP-DOC-1002' in txt and ('Signature requests' in txt or 'Solicitudes de firma' in txt), txt[:200])
    await pg.fill('[data-testid=search-input]', 'statement-december'); await pg.wait_for_timeout(300)
    txt = await pg.inner_text('.palette')
    rec('search finds a file by its file name', 'statement-december' in txt, txt[:200])
    await pg.keyboard.press('Escape')
    record(run, 'no console errors during the flow', not errs, errs[:3])
    await ctx.close()
# ---- end documents and signatures ----------------------------------------------------------------------------------

# ---- leads and clients (appended by the leads and clients module) ---------------------------------------------------
# The professional-services pipeline and client record, end to end: a new lead takes the next turn of the rotation, the
# same person is not entered twice without a decision, a lost lead needs a reason, a won lead lists what it created, a
# client entered twice is merged, a CSV file is imported after a dry run, an export is downloaded and logged, an associate
# asks for access to a client of another office, and a renamed stage shows on the board.
# Run alone with: python3 tests/qa_flows.py lc
LC_CSV = ('Full name,Company,Email,Phone,Client type,Preferred language,SSN,Note\r\n'
          'Rosa Nueva,,rosa.nueva@example.com,609-555-0171,Individual,Spanish,000-00-0000,Met at the fair\r\n'
          'Quinn Tester,,quinn@example.com,,,,,\r\n'
          ',Sample Ferry Tours LLC,ferry@example.com,609-555-0172,LLC,,,\r\n'
          'No Contact,,,,,,,\r\n'
          '"Bad, Email",,not-an-email,609-555-0173,,,,\r\n')

async def leads_clients_flow(browser):
    run = 'practice/leads-clients'
    def rec(name, ok, detail=''): record(run, name, ok, detail)
    ctx, pg, errs = await new_page(browser, 1440, 900)
    await pg.goto(f'{BASE}/demo?industry=practice&lang=en'); await pg.wait_for_selector('#main h1')
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs') || '{}'); p.tourSeen = true; p.viewAs = 'owner'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    async def data(): return (await state(pg))['data']
    async def view_as(role):
        await pg.evaluate("(r) => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = r; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }", role)
    s0 = await data()
    users = {u['id']: u['name'] for u in s0['users']}

    # 1 the settings say who is next; a new lead with nobody chosen goes to that person and records how
    await pg.goto(BASE + '/demo/settings/pipeline'); await pg.wait_for_selector('[data-testid=pipeline-next] b')
    nxt = (await pg.inner_text('[data-testid=pipeline-next] b')).strip()
    await pg.goto(BASE + '/demo/leads'); await pg.click('[data-testid=leads-new]')
    inputs = pg.locator('.modal input')
    await inputs.nth(0).fill('Quinn Tester'); await inputs.nth(2).fill('609-555-0199'); await inputs.nth(3).fill('quinn@example.com')
    await pg.locator('[data-testid=leads-services] label').nth(0).click()
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(500)
    s = await data(); lead = next((l for l in s['leads'] if l['name'] == 'Quinn Tester'), None)
    rec('lead created', lead is not None and len(s['leads']) == len(s0['leads']) + 1)
    if not lead: await ctx.close(); return
    rec('the next person in turn got the lead', users.get(lead['ownerId']) == nxt and (lead.get('handoffs') or [{}])[0].get('how') == 'round_robin', f"{users.get(lead['ownerId'])} / {nxt}")
    rec('service of interest saved', len(lead.get('serviceIds') or []) == 1)
    rec('lead page opened', f"/demo/leads/{lead['id']}" in pg.url, pg.url)

    # 2 the same email again is stopped until the person says it is a separate request
    await pg.goto(BASE + '/demo/leads'); await pg.click('[data-testid=leads-new]')
    inputs = pg.locator('.modal input')
    await inputs.nth(0).fill('Quinn Again'); await inputs.nth(2).fill('609-555-0198'); await inputs.nth(3).fill('QUINN@example.com')
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(300)
    s = await data()
    rec('a second lead with the same email is stopped', await pg.locator('[data-testid=leads-dup]').count() == 1 and not any(l['name'] == 'Quinn Again' for l in s['leads']))
    await pg.check('[data-testid=leads-dup-sure]'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(500)
    s = await data(); again = next((l for l in s['leads'] if l['name'] == 'Quinn Again'), None)
    rec('and added once the person decides', again is not None)

    # 3 next action; 4 lost needs a reason from the list
    if again:
        await pg.goto(f"{BASE}/demo/leads/{again['id']}"); await pg.click('[data-testid=leads-set-next]')
        await pg.locator('.modal input').nth(0).fill('Ask which year she needs'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(300)
        l = next(x for x in (await data())['leads'] if x['id'] == again['id'])
        rec('next action saved with a due date', (l.get('nextAction') or {}).get('text') == 'Ask which year she needs' and bool((l.get('nextAction') or {}).get('due')))
        await pg.click('[data-testid=leads-lost]'); await pg.click('[data-testid=leads-lost-save]'); await pg.wait_for_timeout(200)
        l = next(x for x in (await data())['leads'] if x['id'] == again['id'])
        rec('lost without a reason is refused', l['status'] != 'lost' and await pg.locator('[data-testid=leads-lost-reasons] [role=alert]').count() == 1)
        await pg.click('[data-reason=price]'); await pg.click('[data-testid=leads-lost-save]'); await pg.wait_for_timeout(400)
        l = next(x for x in (await data())['leads'] if x['id'] == again['id'])
        rec('lost with a reason from the list, and the day', l['status'] == 'lost' and l.get('lostReason') == 'price' and bool(l.get('lostAt')), l.get('lostReason'))

    # 5 winning the lead keeps the person on the lead, which lists what was created
    await pg.goto(f"{BASE}/demo/leads/{lead['id']}"); await pg.click('[data-testid=leads-convert]'); await confirm(pg); await pg.wait_for_timeout(600)
    s = await data(); lead = next(l for l in s['leads'] if l['id'] == lead['id'])
    rec('won lead has a client and an engagement', lead['status'] == 'won' and any(c['id'] == lead.get('clientId') for c in s['clients']) and any(j['id'] == lead.get('jobId') for j in s['jobs']))
    rec('the lead lists what winning it created', await pg.locator('[data-testid=leads-won] [data-testid=leads-open-client]').count() == 1 and await pg.locator('[data-testid=leads-won] [data-testid=leads-open-job]').count() == 1)
    n_clients = len(s['clients'])

    # 6 the same person as a new client: the form says so and waits for a decision
    await pg.goto(BASE + '/demo/clients'); await pg.click('[data-testid=clients-new]')
    await pg.fill('#cf-name', 'Quinn T. Tester'); await pg.fill('#cf-email', 'quinn@example.com')
    await pg.wait_for_selector('[data-testid=clients-dup]', timeout=4000)
    await pg.click('[data-testid=clients-save]'); await pg.wait_for_timeout(300)
    rec('a likely duplicate is not created without a decision', len((await data())['clients']) == n_clients and await pg.locator('[data-testid=clients-form]').count() == 1)
    await pg.check('[data-testid=clients-dup-sure]'); await pg.click('[data-testid=clients-save]'); await pg.wait_for_timeout(500)
    s = await data(); twin = next((c for c in s['clients'] if c['name'] == 'Quinn T. Tester'), None)
    rec('created once the person decides', twin is not None and len(s['clients']) == n_clients + 1)

    # 7 merge the second record into the first
    if twin:
        await pg.goto(f"{BASE}/demo/clients/{twin['id']}"); await pg.click('[data-testid=clients-more]'); await pg.click('[data-testid=clients-merge]')
        await pg.locator('[data-testid=clients-merge-list] button').first.click(); await pg.wait_for_timeout(200)
        # the record with the engagement is the one worth keeping
        if await pg.locator('[data-testid=clients-merge-plan] .keep .t').inner_text() != 'Quinn Tester': await pg.click('[data-testid=clients-merge-flip]')
        await pg.click('[data-testid=clients-merge-run]'); await pg.wait_for_timeout(600)
        s = await data()
        rec('merged into one record', len(s['clients']) == n_clients and not any(c['id'] == twin['id'] for c in s['clients']) and any(a['kind'] == 'client.merged' for a in s['activity']))
        rec('nothing points at the removed record', twin['id'] not in json.dumps({k: s[k] for k in ['jobs', 'tasks', 'docs', 'leads', 'messages', 'appointments', 'opportunities']}))

    # 8 import: dry run first, then the rows that are new
    await pg.goto(BASE + '/demo/clients'); await pg.click('[data-testid=clients-import]')
    await pg.set_input_files('[data-testid=data-import-input]', {'name': 'clients.csv', 'mimeType': 'text/csv', 'buffer': LC_CSV.encode('utf-8')})
    await pg.wait_for_selector('[data-testid=data-import-columns]')
    rec('the tax ID column is never offered for import', 'Never imported' in await pg.inner_text('[data-testid=data-import-columns]'))
    await pg.click('[data-testid=data-import-next]'); await pg.wait_for_selector('[data-testid=data-import-check]')
    counts = [int((await pg.inner_text(f'[data-testid={t}] b')).strip()) for t in ['data-count-new', 'data-count-dup', 'data-count-bad']]
    rec('dry run: 2 new, 1 already on file, 2 with a problem', counts == [2, 1, 2], counts)
    rec('the dry run wrote nothing', len((await data())['clients']) == n_clients)
    await pg.click('[data-testid=data-import-run]'); await pg.wait_for_selector('[data-testid=data-import-done]')
    s = await data(); rosa = next((c for c in s['clients'] if c['name'] == 'Rosa Nueva'), None)
    rec('import added the new rows only', len(s['clients']) == n_clients + 2 and rosa is not None and rosa.get('lang') == 'es')
    rec('no tax ID came in with the file', rosa is not None and '000-00-0000' not in json.dumps(s['clients']) and not rosa.get('taxIdLast4'))
    async with pg.expect_download() as dl: await pg.click('[data-testid=data-import-errors]')
    left = open(await (await dl.value).path(), encoding='utf-8-sig').read()
    rec('the rows left out can be downloaded with the reason', 'Why it was not imported' in left and 'not-an-email' in left and 'Rosa Nueva' not in left, left[:120])
    rec('the tax ID column is not in that file either', 'SSN' not in left and '000-00-0000' not in left)
    await pg.click('[data-testid=data-import-close]')

    # 9 export: the filtered list, logged, without tax fields
    await pg.fill('.clients-filters input[type=search]', 'rosa'); await pg.wait_for_timeout(500)
    n_audit = len(s['audit'])
    async with pg.expect_download() as dl: await pg.click('[data-testid=clients-export]')
    out = open(await (await dl.value).path(), encoding='utf-8-sig').read()
    s = await data()
    rec('export holds the filtered list', out.startswith('Full name,') and 'Rosa Nueva' in out and 'Quinn Tester' not in out, out[:120])
    rec('export never carries a tax field', 'tax' not in out.lower() and 'ssn' not in out.lower())
    rec('export is written to the audit trail', len(s['audit']) == n_audit + 1 and s['audit'][0]['action'].startswith('export'), s['audit'][0] if s['audit'] else '')

    # 10 an associate: clients of the other office are counted, named and can be asked for
    await view_as('staff'); await pg.goto(BASE + '/demo/clients'); await pg.wait_for_selector('[data-testid=clients-table]')
    n_other = await pg.locator('[data-testid=clients-other] .item').count()
    rec('clients outside the associate\'s office are listed by name only', n_other >= 1)
    n_req = len(s['accessRequests'])
    ask = pg.locator('[data-testid=clients-ask-access]')
    if await ask.count():
        await ask.first.click(); await pg.fill('.modal textarea', 'Preparing the return this week'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(400)
        s = await data()
        rec('asking for access files a waiting request with the reason', len(s['accessRequests']) == n_req + 1 and s['accessRequests'][-1]['status'] == 'pending' and s['accessRequests'][-1]['reason'] == 'Preparing the return this week')
    await pg.goto(BASE + '/demo/leads'); await pg.wait_for_selector('[data-testid=leads-table]')
    rec('the lead list says that leads of other offices are not shown', await pg.locator('[data-testid=leads-hidden]').count() == 1)
    rec('an associate has no export', await pg.locator('[data-testid=leads-export]').count() == 0)
    await view_as('readonly'); await pg.goto(BASE + '/demo/leads'); await pg.wait_for_selector('[data-testid=leads-table]')
    rec('read only: no way to add, import or change', await pg.locator('[data-testid=leads-new], [data-testid=leads-import]').count() == 0)

    # 11 a renamed stage shows on the board
    await view_as('owner'); await pg.goto(BASE + '/demo/settings/pipeline'); await pg.wait_for_selector('[data-testid=pipeline-stages]')
    await pg.locator('[data-testid=pipeline-stages] .leads-set-row input').first.fill('Fresh')
    await pg.click('[data-testid=pipeline-stages-save]'); await pg.wait_for_timeout(400)
    await pg.goto(BASE + '/demo/leads?view=board'); await pg.wait_for_selector('[data-testid=leads-board]')
    rec('a renamed stage shows on the board', 'Fresh' in await pg.locator('[data-testid=leads-board] .kcol-h').first.inner_text())
    await pg.goto(BASE + '/demo/settings/pipeline'); await pg.wait_for_selector('[data-testid=pipeline-stages]')
    await pg.locator('[data-testid=pipeline-stages] [data-stage=won] [data-testid=pipeline-stage-remove]').click()
    rec('the only won stage cannot be saved away', await pg.is_disabled('[data-testid=pipeline-stages-save]') or await pg.locator('[data-testid=pipeline-problem]').count() == 1)
    record(run, 'no console errors during the flow', not errs, errs[:3])
    await ctx.close()
# ---- end leads and clients ------------------------------------------------------------------------------------------

# ---- automations, reviews and the assistant (appended by the automation module) -------------------------------------
# Three flows: (1) the Automations screen in a field edition and in the practice edition: build a rule with conditions and
# two steps, see the preview count, watch it run once for a matching lead, find the run in the history, switch it off,
# copy and delete, change a shipped rule and reset it; (2) review requests in the practice sample: the draft the rule
# prepared, sending (shown as sent, never "sent"), the client's page for a high and a low rating, the public link offered
# to both, roles; (3) the assistant: every suggestion answers, a tax ID is refused, an appointment is only booked on Confirm.
# Run alone with: python3 tests/qa_flows.py auto
import re as _re
from datetime import date as _date

async def view_as(pg, role):
    await pg.evaluate("(r) => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = r; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }", role)
async def _auto_data(pg):
    return (await globals()['state'](pg))['data']
async def _auto_start(browser, first):
    ctx, pg, errs = await new_page(browser, 1440, 900)
    await pg.goto(BASE + first); await pg.wait_for_selector('#main h1')
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs') || '{}'); p.tourSeen = true; p.viewAs = 'owner'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    return ctx, pg, errs

async def auto_rules_flow(browser, pack_id, lang):
    run = f'{pack_id}/automations/{lang}'
    def rec(name, ok, detail=''): record(run, name, ok, detail)
    state = _auto_data
    date = _date
    ctx, pg, errs = await _auto_start(browser, f'/demo?industry={pack_id}&lang={lang}')
    s0 = await state(pg)
    n_rules = len(s0['rules'])

    # the list
    await pg.goto(BASE + '/demo/automations'); await pg.wait_for_selector('[data-testid=auto-try]', timeout=30000)
    cards = await pg.locator('[data-testid^=auto-rule-]').count()
    rec('rules listed as cards', cards >= 8, cards)
    rec('the coded lead intake rule reads as before', 'follow-up' in (await pg.locator('[data-testid=auto-rule-lead-intake]').inner_text()).lower() or 'seguimiento' in (await pg.locator('[data-testid=auto-rule-lead-intake]').inner_text()).lower())

    # build a rule: website leads worth more than 1000 -> a task for the owner and a note to the manager
    await pg.click('[data-testid=auto-new]'); await pg.wait_for_selector('[data-testid=auto-b-name]')
    await pg.click('[data-testid=auto-b-save]'); await pg.wait_for_timeout(200)
    rec('saving an empty rule is refused with the reason', await pg.locator('[data-testid=auto-b-problem]').count() == 1)
    await pg.fill('[data-testid=auto-b-name]', 'Big website leads')
    await pg.select_option('[data-testid=auto-b-event]', 'lead.created')
    await pg.click('[data-testid=auto-b-add-cond]'); await pg.select_option('[data-testid=auto-b-cond-0-field]', 'lead.source'); await pg.select_option('[data-testid=auto-b-cond-0-value]', 'website')
    await pg.click('[data-testid=auto-b-add-cond]'); await pg.select_option('[data-testid=auto-b-cond-1-field]', 'lead.value'); await pg.select_option('[data-testid=auto-b-cond-1-op]', 'gt'); await pg.fill('[data-testid=auto-b-cond-1-value]', '1000')
    hits_before = await pg.locator('[data-testid=auto-b-preview]').get_attribute('data-hits')
    total = await pg.locator('[data-testid=auto-b-preview]').get_attribute('data-total')
    s = await state(pg)
    recent = [l for l in s['leads'] if (date.today() - date.fromisoformat(l['created'])).days <= 30]
    want = len([l for l in recent if l['source'] == 'website' and (l.get('value') or 0) > 1000])
    rec('preview counts the matching leads on file', int(hits_before) == want and int(total) == len(recent), f'{hits_before}/{total} want {want}/{len(recent)}')
    await pg.click('[data-testid=auto-b-add-task]'); await pg.fill('[data-testid=auto-s0-title]', 'Call the big lead')
    await pg.focus('[data-testid=auto-s0-title]'); await pg.locator('.auto-b-chip').first.click()
    rec('a merge field is added to the text', '{{' in await pg.input_value('[data-testid=auto-s0-title]'))
    await pg.select_option('[data-testid=auto-s0-for]', 'owner')
    await pg.click('[data-testid=auto-b-add-notify]'); await pg.fill('[data-testid=auto-s1-text]', 'A big lead came in')
    sentence = await pg.locator('[data-testid=auto-b-sentence]').inner_text()
    rec('the rule reads as a sentence', ('website' in sentence.lower() or 'sitio web' in sentence.lower()) and '1,000' in sentence and len(sentence) > 60, sentence)
    rec('no raw merge braces or wording keys in the sentence', '{{' not in sentence and 'auto.' not in sentence, sentence)
    await pg.click('[data-testid=auto-b-save]'); await pg.wait_for_selector('[data-testid=auto-try]')
    s = await state(pg)
    mine = [r for r in s['rules'] if r['name']['en'] == 'Big website leads']
    rec('the rule is saved in the company list', len(mine) == 1 and not mine[0].get('shipped') and len(s['rules']) >= n_rules + 1, len(s['rules']))
    rid = mine[0]['id']
    rec('it shows in the list as the company\'s own', await pg.locator(f'[data-testid=auto-rule-{rid}]').count() == 1 and await pg.locator(f'[data-testid=auto-cond-{rid}]').count() == 1)

    # the try-it lead comes from the website with no value: only the intake rules run, not the new one
    await pg.click('[data-testid=auto-try]'); await pg.wait_for_timeout(500)
    s = await state(pg)
    rec('the sample lead runs the intake rule', any(r['ruleId'] == 'lead-intake' for r in s['automation']['runs']))
    rec('the new rule did not match a lead without a value', not any(r['ruleId'] == rid for r in s['automation']['runs']))
    # a lead that matches, through the Leads screen
    await pg.goto(BASE + '/demo/leads'); await pg.click('[data-testid=leads-new]')
    inputs = pg.locator('.modal input')
    await inputs.nth(0).fill('Quinn Tester'); await inputs.nth(2).fill('609-555-0199'); await inputs.nth(3).fill('quinn@example.com')
    src = pg.locator('.modal select').filter(has=pg.locator('option[value=website]')).first
    await src.select_option('website')
    val = pg.locator('.modal input[type=number]').first
    await val.fill('2500')
    await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(700)
    s = await state(pg)
    lead = next((l for l in s['leads'] if l['name'] == 'Quinn Tester'), None)
    rec('lead created through the form', lead is not None)
    if lead:
        runs = [r for r in s['automation']['runs'] if r.get('ref', {}).get('id') == lead['id']]
        mine_run = [r for r in runs if r['ruleId'] == rid]
        rec('the new rule ran once for the matching lead', len(mine_run) == 1 and mine_run[0].get('status') == 'ok', [r['ruleId'] for r in runs])
        rec('its task was created for the owner', any(t['title'].startswith('Call the big lead') and t.get('leadId') == lead['id'] for t in s['tasks']))
        rec('its note to the manager was written', any(m['channel'] == 'system' and m['body'] == 'A big lead came in' for m in s['messages']))
        rec('every run has its own key', len(set(r.get('dedupe') for r in s['automation']['runs'] if r.get('dedupe'))) == len([r for r in s['automation']['runs'] if r.get('dedupe')]))

    # history: filter by rule, link to the record
    await pg.goto(BASE + '/demo/automations/history'); await pg.wait_for_selector('[data-testid=auto-hist-table]')
    all_rows = await pg.locator('[data-testid=auto-hist-table] tbody tr').count()
    await pg.select_option('[data-testid=auto-hist-rule]', rid); await pg.wait_for_timeout(200)
    rows = await pg.locator('[data-testid=auto-hist-table] tbody tr').count()
    rec('history filters by rule', rows == 1 and all_rows > 1, f'{rows} of {all_rows}')
    href = await pg.locator('[data-testid=auto-hist-table] tbody tr a.auto-link').first.get_attribute('href')
    rec('a run links to its record', lead is not None and href.endswith('/leads/' + lead['id']), href)
    await pg.select_option('[data-testid=auto-hist-rule]', ''); await pg.select_option('[data-testid=auto-hist-status]', 'failed'); await pg.wait_for_timeout(200)
    rec('filter by result', await pg.locator('[data-testid=auto-hist-table] tbody tr').count() == 0)

    # switch the new rule off, duplicate, delete
    await pg.goto(BASE + '/demo/automations'); await pg.wait_for_selector(f'[data-testid=auto-toggle-{rid}]')
    await pg.click(f'[data-testid=auto-toggle-{rid}]'); await pg.wait_for_timeout(200)
    s = await state(pg)
    rec('switching a rule off is saved', next(r for r in s['rules'] if r['id'] == rid)['active'] is False and s['automation']['enabled'].get(rid) is False)
    await pg.click(f'[data-testid=auto-menu-{rid}]'); await pg.click(f'[data-testid=auto-copy-{rid}]'); await pg.wait_for_selector('[data-testid=auto-b-name]')
    rec('a copy opens in the builder, switched off', '(cop' in (await pg.input_value('[data-testid=auto-b-name]')).lower() and not await pg.is_checked('[data-testid=auto-b-active]'))
    await pg.click('[data-testid=auto-b-delete]'); await pg.click('.modal [data-autofocus]'); await pg.wait_for_selector('[data-testid=auto-try]')
    s = await state(pg)
    rec('the copy is deleted', len([r for r in s['rules'] if 'Big website leads' in r['name']['en']]) == 1)

    # a shipped rule: edit, see "changed", reset
    shipped = next((r for r in s['rules'] if r.get('shipped') and not any(x['do'] == 'builtin' for x in r['then']) and r['when'].get('days') is not None), None)
    if shipped:
        sid = shipped['id']
        await pg.goto(BASE + f'/demo/automations/rule/{sid}'); await pg.wait_for_selector('[data-testid=auto-b-days]')
        await pg.fill('[data-testid=auto-b-days]', '9'); await pg.click('[data-testid=auto-b-save]'); await pg.wait_for_selector('[data-testid=auto-try]')
        s = await state(pg)
        rec('a shipped rule can be changed', next(r for r in s['rules'] if r['id'] == sid)['when']['days'] == 9)
        await pg.click(f'[data-testid=auto-menu-{sid}]'); await pg.click(f'[data-testid=auto-reset-{sid}]'); await pg.click('.modal [data-autofocus]'); await pg.wait_for_timeout(300)
        s = await state(pg)
        rec('and reset to how it shipped', next(r for r in s['rules'] if r['id'] == sid)['when']['days'] == shipped['when']['days'])
        rec('a shipped rule has no delete', await pg.locator(f'[data-testid=auto-delete-{sid}]').count() == 0)
    # a coded rule opens in the builder with its steps fixed
    await pg.goto(BASE + '/demo/automations/rule/lead-intake'); await pg.wait_for_selector('[data-testid=auto-b-name]')
    rec('a coded rule shows its built-in steps and cannot be copied', await pg.locator('.auto-b-step.fixed').count() == 1 and await pg.locator('[data-testid=auto-b-copy]').count() == 0 and await pg.is_disabled('[data-testid=auto-b-event]'))

    # read only: sees no screen at all (the role lacks it); staff too in the field editions
    await view_as(pg, 'readonly')
    await pg.goto(BASE + '/demo/automations/new'); await pg.wait_for_timeout(700)
    rec('a role without the screen cannot open the builder', await pg.locator('[data-testid=auto-b-name]').count() == 0)
    await view_as(pg, 'manager')
    await pg.goto(BASE + '/demo/automations'); await pg.wait_for_timeout(900)
    rec('a manager sees the rules and may build', await pg.locator('[data-testid=auto-new]').count() == 1)
    rec('no console errors', not errs, errs[:3])
    await ctx.close()

async def auto_reviews_flow(browser):
    run = 'practice/reviews'
    def rec(name, ok, detail=''): record(run, name, ok, detail)
    state = _auto_data
    ctx, pg, errs = await _auto_start(browser, '/demo?industry=practice&lang=en')
    s = await state(pg)
    rated0 = [r for r in s['reviews'] if r['status'] == 'rated']
    avg = round(sum(r['rating'] for r in rated0) / len(rated0), 1)
    draft = next((r for r in s['reviews'] if r['status'] == 'draft'), None)
    rec('sample: two answered reviews and a draft prepared by the rule', len(rated0) == 2 and draft is not None and draft['by'] == 'automation', [r['status'] for r in s['reviews']])
    low = next(r for r in rated0 if r['rating'] <= 3)
    rec('sample: the low rating has its follow-up task', any(t.get('auto') == 'review-low:' + low['id'] for t in s['tasks']))
    rec('sample: the review rule left a run in the history', any(r['ruleId'] == 'p-review-request' for r in s['automation']['runs']))

    await pg.goto(BASE + '/demo/reviews'); await pg.wait_for_selector('[data-testid=reviews-table]', timeout=30000)
    shown = await pg.locator('[data-testid=reviews-kpi-average] .v').inner_text()
    rec('the average is computed from the answers on record', shown.strip().startswith(f'{avg:.1f}'), f'{shown!r} want {avg}')
    rec('requests listed', await pg.locator('[data-testid=reviews-table] tbody tr').count() == len(s['reviews']))
    # settings: a bad link is refused, a good one saved
    await pg.fill('[data-testid=reviews-url]', 'http://example.com/review'); await pg.click('[data-testid=reviews-save]'); await pg.wait_for_timeout(200)
    s = await state(pg)
    rec('a link that is not https is refused', not (s['settings'].get('reviews') or {}).get('publicUrl'))
    await pg.fill('[data-testid=reviews-url]', 'https://example.com/sample-review'); await pg.fill('[data-testid=reviews-delay]', '5'); await pg.click('[data-testid=reviews-save]'); await pg.wait_for_timeout(300)
    s = await state(pg)
    rec('delay and public link saved', s['settings']['reviews'] == {'delayDays': 5, 'linkDays': 30, 'publicUrl': 'https://example.com/sample-review'}, s['settings'].get('reviews'))
    # the draft: read the message, send it (sample: shown as sent, never "sent")
    if await pg.locator(f"[data-testid=reviews-read-{draft['id']}]").count():
        await pg.click(f"[data-testid=reviews-read-{draft['id']}]"); await pg.wait_for_selector('.reviews-msg')
        body = await pg.locator('.reviews-msg').inner_text()
        rec('the prepared message carries the private link', '/review/sample-' in body, body[:120])
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
    else: rec('the prepared message carries the private link', False, 'no message on the draft')
    await pg.click(f"[data-testid=reviews-send-{draft['id']}]"); await pg.wait_for_timeout(400)
    s = await state(pg)
    r = next(x for x in s['reviews'] if x['id'] == draft['id'])
    rec('sending in the sample marks it demo, never sent', r['status'] == 'demo', r['status'])
    msg = next((m for m in s['messages'] if m['id'] == r.get('messageId')), None)
    rec('its message is marked demo too', msg is not None and msg['status'] == 'demo', msg and msg['status'])
    rec('no message anywhere says sent or delivered', not any(m['status'] in ('sent', 'delivered') for m in s['messages']))

    # ask by hand: only clients who can be asked are offered, and the reason is said
    await pg.click('[data-testid=reviews-ask]'); await pg.wait_for_selector('.modal')
    if await pg.locator('[data-testid=reviews-f-client]').count():
        await pg.select_option('[data-testid=reviews-f-channel]', 'text'); await pg.wait_for_timeout(150)
        # each offered client either can be asked or gets a reason before the button
        dis = await pg.is_disabled('[data-testid=reviews-prepare]'); prob = await pg.locator('[data-testid=reviews-f-problem]').count()
        rec('a reason is shown exactly when the button is off', dis == (prob == 1), f'{dis} {prob}')
    else:
        rec('nobody can be asked right now, and the form says so', await pg.locator('.modal .muted').count() >= 1)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)

    # the client's view of the request that was just sent: labelled as a sample; a high rating is offered the public link
    await pg.click(f"[data-testid=reviews-view-{draft['id']}]"); await pg.wait_for_selector('[data-testid=review-submit]', timeout=30000)
    rec('the client page is labelled as a sample', await pg.locator('[data-testid=review-sample]').count() == 1)
    text = await pg.locator('[data-testid=public-review]').inner_text()
    rec('the page says nothing about publishing the answer', 'publish' not in text.lower() and 'public' not in text.lower() and 'publica' not in text.lower(), text[:200])
    await pg.click('[data-testid=review-submit]'); await pg.wait_for_timeout(200)
    rec('a rating is required', await pg.locator('[data-testid=review-done]').count() == 0)
    await pg.locator('[data-testid=review-star-5]').check(force=True); await pg.fill('[data-testid=review-comment]', 'Sample answer typed in the test.')
    await pg.click('[data-testid=review-submit]'); await pg.wait_for_selector('[data-testid=review-done]')
    rec('a high rating is thanked and offered the public link', await pg.locator('[data-testid=review-public-link]').get_attribute('href') == 'https://example.com/sample-review' and await pg.locator('[data-testid=review-public]').get_attribute('data-low') == 'false')
    s = await state(pg)
    r = next(x for x in s['reviews'] if x['id'] == draft['id'])
    rec('the answer is on the request', r['status'] == 'rated' and r['rating'] == 5 and r['comment'] == 'Sample answer typed in the test.', r)
    rec('a high rating creates no follow-up task', not any(t.get('auto') == 'review-low:' + r['id'] for t in s['tasks']))
    # the same link again: already used
    await pg.goto(BASE + '/review/' + r['token']); await pg.wait_for_selector('[data-testid=public-review] [data-state]', timeout=30000); await pg.wait_for_timeout(600)
    rec('a link works once', await pg.locator('[data-testid=review-submit]').count() == 0)

    # a low rating: thanked, told someone will call, a task for the manager, and still shown the public link
    opened = next((x for x in s['reviews'] if x['status'] in ('opened', 'demo', 'draft')), None)
    if opened:
        await pg.goto(BASE + '/review/' + opened['token']); await pg.wait_for_selector('[data-testid=review-submit]', timeout=30000)
        await pg.locator('[data-testid=review-star-2]').check(force=True); await pg.click('[data-testid=review-submit]'); await pg.wait_for_selector('[data-testid=review-done]')
        rec('a low rating is still shown the public link, not as the main action', await pg.locator('[data-testid=review-public]').get_attribute('data-low') == 'true' and await pg.locator('[data-testid=review-public-link]').count() == 1)
        s = await state(pg)
        t = next((t for t in s['tasks'] if t.get('auto') == 'review-low:' + opened['id']), None)
        mgr = next(u for u in s['users'] if u['role'] == 'manager')
        rec('a low rating creates a task for the manager', t is not None and t['pri'] == 'high' and t['clientId'] == opened['clientId'] and t['assignee'].startswith('u:'), t)
        await pg.click('[data-testid=review-back]'); await pg.wait_for_selector('[data-testid=reviews-table]', timeout=30000)
        rec('back in the workspace, the answers show', await pg.locator('[data-testid=reviews-table] tr[data-state=rated]').count() == 4)
    await pg.goto(BASE + '/review/sample-nothing'); await pg.wait_for_timeout(1500)
    rec('an unknown link says so', await pg.locator('[data-testid=public-review] [data-state=missing]').count() == 1)
    n_err = len(errs)
    await pg.goto(BASE + '/review/abcdef0123456789abcdef0123456789'); await pg.wait_for_timeout(1500)
    st = await pg.locator('[data-testid=public-review] [data-state]').get_attribute('data-state')
    rec('a live link without a server behind it says it cannot be opened', st in ('unavailable', 'missing'), st)
    # The preview server has no database, so it answers this address with 503 "not configured" on purpose, and the browser
    # writes every refused request to its console. That one line is expected here; any other error of this step still counts.
    errs[n_err:] = [e for e in errs[n_err:] if 'Failed to load resource' not in e]

    # roles
    await pg.goto(BASE + '/demo'); await pg.wait_for_selector('#main h1', timeout=30000)
    await view_as(pg, 'readonly')
    await pg.goto(BASE + '/demo/reviews'); await pg.wait_for_selector('[data-testid=reviews-table]', timeout=30000)
    rec('read only: sees the requests, cannot ask, send or change the settings', await pg.locator('[data-testid=reviews-ask]').count() == 0 and await pg.locator('[data-testid^=reviews-send-]').count() == 0 and await pg.locator('[data-testid=reviews-save]').count() == 0)
    await view_as(pg, 'staff')
    await pg.goto(BASE + '/demo/reviews'); await pg.wait_for_selector('[data-testid=reviews-kpis]', timeout=30000)
    n_staff = await pg.locator('[data-testid=reviews-table] tbody tr').count()
    rec('an associate sees only the requests of clients they may see', n_staff < len(s['reviews']), n_staff)
    rec('an associate may ask, but not change how requests work', await pg.locator('[data-testid=reviews-ask]').count() == 1 and await pg.locator('[data-testid=reviews-save]').count() == 0)
    rec('no console errors', not [e for e in errs if '404' not in e], errs[:3])
    await ctx.close()

async def _ask(pg, q):
    n = await pg.locator('[data-testid=asst-log] .asst-msg.bot').count()
    await pg.fill('[data-testid=asst-input]', q); await pg.click('[data-testid=asst-send]')
    await pg.wait_for_function("(n) => document.querySelectorAll('[data-testid=asst-log] .asst-msg.bot').length > n", arg=n, timeout=20000)
    return pg.locator('[data-testid=asst-log] .asst-msg.bot').last
async def auto_assistant_flow(browser):
    run = 'practice/assistant'
    def rec(name, ok, detail=''): record(run, name, ok, detail)
    state = _auto_data
    ask = _ask; re = _re
    ctx, pg, errs = await _auto_start(browser, '/demo?industry=practice&lang=en')
    await pg.goto(BASE + '/demo/assistant'); await pg.wait_for_selector('#main h1', timeout=30000); await pg.wait_for_timeout(600)
    title = await pg.locator('#main h1').first.inner_text()
    rec('it is called VYNTEX AI in this deployment and is on', title.strip() == 'VYNTEX AI' and await pg.locator('[data-testid=asst-input]').count() == 1, title)
    chips = await pg.locator('[data-testid=asst-chip]').all_inner_texts()
    examples = await pg.locator('.asst-can .asst-ex').all_inner_texts()
    rec('suggestions offered', len(chips) >= 5 and len(examples) >= 10, f'{len(chips)} {len(examples)}')
    before = await state(pg); unknown = []
    for q in dict.fromkeys(chips + examples):
        last = await ask(pg, q)
        if await last.get_attribute('data-unknown'): unknown.append(q)
        # an open card is left unconfirmed: the next request replaces it
    rec('every suggested request is understood', not unknown, unknown)
    log = await pg.locator('[data-testid=asst-log]').inner_text()
    rec('no wording key or unfilled token in any answer', not re.search(r'(?<![\w@./-])(asst|auto|reviews|common)\.[a-z]+[.\w]*', log) and not re.search(r'\{[A-Za-z_]+\}', log), (re.search(r'(?<![\w@./-])(asst|auto|reviews|common)\.[a-z]+[.\w]*|\{[A-Za-z_]+\}', log) or [''])[0])
    after = await state(pg)
    rec('asking and being offered a card changes nothing', all(len(before[k]) == len(after[k]) for k in ['tasks', 'leads', 'appointments', 'reviews', 'messages']) and [j['status'] for j in before['jobs']] == [j['status'] for j in after['jobs']])
    await pg.click('[data-testid=asst-clear]')

    s = await state(pg)
    client = s['clients'][0]
    # a tax ID
    last = await ask(pg, f"What is the SSN of {client['name']}?" if True else f"cual es el seguro social de {client['name']}")
    t = await last.inner_text()
    rec('a tax ID is refused', (client.get('taxIdLast4') or '####') not in t and ('tax ID' in t or 'identificaciones fiscales' in t), t[:120])
    # what was typed is masked on screen
    await ask(pg, 'note for nobody 123-45-6789')
    rec('a typed number shaped like a tax ID is masked on screen', '123-45-6789' not in await pg.locator('[data-testid=asst-log]').inner_text())

    # an appointment: proposed, nothing changes until Confirm
    n0 = len(s['appointments'])
    q = f"Book an appointment with {client['name']} tomorrow at 7:15am" if True else f"Programa una cita con {client['name']} mañana a las 7:15am"
    last = await ask(pg, q)
    if await last.locator('[data-testid=asst-choice]').count(): await last.locator('[data-testid=asst-choice]').first.click(); await pg.wait_for_timeout(200)
    rec('a card says what will be booked', await last.locator('[data-testid=asst-card]').count() == 1 and client['name'] in await last.locator('[data-testid=asst-card]').inner_text())
    s = await state(pg)
    rec('nothing is booked before Confirm', len(s['appointments']) == n0)
    await last.locator('[data-testid=asst-confirm]').click(); await pg.wait_for_timeout(500)
    s = await state(pg)
    res = await last.locator('[data-testid=asst-result]').inner_text()
    booked = [a for a in s['appointments'] if a.get('clientId') == client['id'] and a['time'] == '07:15']
    rec('Confirm books it, or says exactly why not', (len(s['appointments']) == n0 + 1 and len(booked) == 1) or (len(s['appointments']) == n0 and len(res) > 10), res[:120])

    # read only: answers, but no Confirm
    await view_as(pg, 'readonly')
    await pg.goto(BASE + '/demo/assistant'); await pg.wait_for_selector('[data-testid=asst-input]', timeout=30000)
    last = await ask(pg, 'Create a task for tomorrow: call the bank' if True else 'Crea una tarea para mañana: llamar al banco')
    rec('read only gets no Confirm button', await last.locator('[data-testid=asst-confirm]').count() == 0)
    rec('no console errors', not errs, errs[:3])
    await ctx.close()
# ---- end automations, reviews and the assistant ---------------------------------------------------------------------

async def main():
    args = sys.argv[1:]
    runs = [tuple((a.split(':') + ['en', 'desktop'])[:3]) for a in args] if args else [(p, 'en', 'desktop') for p in FACTS if FACTS[p].get('family', 'field') == 'field'] + [('clean', 'es', 'phone'), ('turnover', 'es', 'desktop'), ('build', 'es', 'phone')]
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        for pack_id, lang, size in runs:
            if pack_id in ('sales', 'docs', 'lc', 'auto'): continue
            print('flow', pack_id, lang, size, flush=True)
            try: await flow(b, pack_id, lang, size)
            except Exception as e: record(f'{pack_id}/{lang}/{size}', 'flow ran to the end', False, repr(e)[:300])
        if not args or any(a.startswith('sales') for a in args):
            print('sales pages', flush=True)
            try: await sales(b)
            except Exception as e: record('sales', 'flow ran to the end', False, repr(e)[:300])
        # ---- documents and signatures (appended by the documents and e-signature module) ----
        if not args or any(a.startswith('docs') for a in args):
            print('documents and signatures, professional services', flush=True)
            try: await docs_flow(b)
            except Exception as e: record('practice/docs', 'flow ran to the end', False, repr(e)[:300])
        # ---- end documents and signatures ----
        # ---- leads and clients (appended by the leads and clients module) ----
        if not args or any(a == 'lc' for a in args):
            print('leads and clients, professional services', flush=True)
            try: await leads_clients_flow(b)
            except Exception as e: record('practice/leads-clients', 'flow ran to the end', False, repr(e)[:300])
        # ---- end leads and clients ----
        # ---- automations, reviews and the assistant (appended by the automation module) ----
        if not args or any(a == 'auto' for a in args):
            for name, fn in [('automations, VYNTEX BUILD in Spanish', lambda: auto_rules_flow(b, 'build', 'es')), ('automations, professional services', lambda: auto_rules_flow(b, 'practice', 'en')),
                             ('review requests, professional services', lambda: auto_reviews_flow(b)), ('assistant, professional services', lambda: auto_assistant_flow(b))]:
                print(name, flush=True)
                try: await fn()
                except Exception as e: record('auto/' + name, 'flow ran to the end', False, repr(e)[:300])
        # ---- end automations, reviews and the assistant ----
        await b.close()
    ok = sum(1 for r in RESULTS if r['ok']); bad = [r for r in RESULTS if not r['ok']]
    json.dump(RESULTS, open(os.path.join(ROOT, '.qa-flows' + os.environ.get('QA_OUT', '') + '.json'), 'w'), indent=1)
    print(f'checks passed: {ok} / {len(RESULTS)}')
    for r in bad: print('FAIL', r['run'], '|', r['check'], '|', r['detail'])

asyncio.run(main())
