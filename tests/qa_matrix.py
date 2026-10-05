# QA matrix: every edition (the eight field editions and the professional-services one) x language x screen size, every page
# the edition has. Which pages an edition has comes from tests/.pack-facts.json (its modules, whether it is priced, whether it
# has field workers).
# Checks per page: no console errors, no sideways scroll, no untranslated keys or unfilled {tokens}, product and sample
# company shown, no BUILD-only words in other editions, no English leftovers in Spanish, no long dashes in sentences.
# Usage: python3 tests/qa_matrix.py [industry ...]   (PORT env selects the preview server; results in tests/.qa-matrix-<industries>.json)
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
FACTS = json.load(open(os.path.join(ROOT, '.pack-facts.json')))
BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
ONLY = sys.argv[1:]
SIZES = [('desktop', 1440, 900), ('phone', 390, 844)]
# screens added with the edition blueprint; an edition is checked on the ones its module list names
STUB_MODULES = ['appointments', 'catalog', 'opportunities', 'reviews', 'esign', 'integrations', 'social', 'cash', 'payroll', 'bookkeeping', 'licensing', 'deadlines', 'security', 'audit']
KEY_RE = re.compile(r'(?<![\w@./-])(nav|common|demo|role|ts|ent|act|notif|search|form|doc|pr|auto|dash|leads|clients|jobs|tasks|calendar|team|docs|messages|payments|reports|compliance|asst|settings|portal|mk|tour|price|empty|toast|app|auth|public|sync|lang|appointments|catalog|opportunities|reviews|esign|integrations|social|cash|payroll|bookkeeping|licensing|deadlines|security|audit)\.[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]')
TOKEN_RE = re.compile(r'\{[A-Za-z_]+\}')
DASH_RE = re.compile(r'[A-Za-zÀ-ÿ0-9,.;:)] ?[—–] ?[A-Za-zÀ-ÿ(]')
BANNED = {'en': ['project', 'subcontractor', 'contract'], 'es': ['proyecto', 'subcontratista', 'contrato']}
# English interface words that must not survive in Spanish (whole words; chosen to avoid Spanish look-alikes and sample names)
EN_LEFT = ['Save', 'Cancel', 'Delete', 'Search', 'Settings', 'Dashboard', 'Leads', 'Payments', 'Reports', 'Documents', 'Tasks', 'Overdue', 'Today', 'Tomorrow',
           'Add', 'Edit', 'Close', 'Owner', 'Manager', 'Status', 'Priority', 'Amount', 'Balance', 'Received', 'Paid', 'Owed', 'Due', 'New', 'View', 'Open', 'Next', 'Back',
           'Assigned', 'Completed', 'Waiting', 'Review', 'Invoice', 'Estimate', 'Agreement', 'Included', 'Preview', 'Monthly', 'Yearly', 'Calendar', 'Team', 'Notes', 'Activity',
           'Client', 'Clients', 'Job', 'Jobs', 'Worker', 'Workers', 'Crew', 'Staff', 'Unit', 'Units', 'Event', 'Events', 'Cleaner', 'Cleaners']
EN_RE = re.compile(r'(?<![\w/@.-])(' + '|'.join(EN_LEFT) + r')(?![\w@.-])')

def word_re(w):
    return re.compile(r'(?<![A-Za-zÀ-ÿ])' + w + r'(s|es)?(?![A-Za-zÀ-ÿ])', re.I)

async def first_href(pg, prefix):
    return await pg.evaluate("""(p) => { const a = [...document.querySelectorAll('a[href^="' + p + '"]')].map(x => x.getAttribute('href')).find(h => h.length > p.length && !h.includes('?')); return a || null; }""", prefix)

async def run(pack, lang, size_name, w, h, browser, results):
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, locale='en-US')
    pg = await ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:300]))
    await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    await pg.goto(f"{BASE}/demo?industry={pack['id']}&lang={lang}")
    await pg.wait_for_selector('#main', timeout=15000)
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs') || '{}'); p.tourSeen = true; p.planTier = 2; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    await pg.wait_for_timeout(300)

    workers = pack.get('usesWorkers', True); priced = pack.get('priced', True); practice = pack.get('family') == 'practice'
    pages = ['/demo', '/demo/leads', '/demo/leads?view=board', '/demo/clients', '/demo/jobs', '/demo/jobs?view=board', '/demo/calendar', '/demo/calendar?view=agenda',
             '/demo/tasks', '/demo/tasks?view=list', '/demo/team', '/demo/documents', '/demo/messages', '/demo/payments', '/demo/reports', '/demo/reports/sales',
             '/demo/reports/money', '/demo/reports/work', '/demo/automations', '/demo/assistant', '/demo/settings', '/demo/settings/team']
    if workers: pages += ['/demo/reports/team']
    if pack.get('compliance', True): pages += ['/demo/compliance']
    if priced: pages += ['/demo/settings/plan', '/demo/settings/connections']
    # the screens added with the edition blueprint, where the edition has them
    pages += ['/demo/' + m for m in STUB_MODULES if m in pack.get('modules', [])]
    # ---- communications center (begin): its settings section, and one conversation opened in the inbox
    if practice: pages += ['/demo/settings/communications', '/demo/messages?c=c_pc1']
    # ---- communications center (end)
    # --- appointments module (appended): its other views, where the edition has the screen. pa7 is a fixed id of the sample firm.
    if 'appointments' in pack.get('modules', []):
        pages += ['/demo/appointments?tab=past', '/demo/appointments?view=agenda', '/demo/appointments/credits', '/demo/appointments/pa7', '/demo/settings/appointments']
    # --- end appointments module
    pages += ['/', '/pricing', '/request-demo']
    # ---- documents and signatures (appended by the documents and e-signature module): the sample records of the practice edition ----
    if practice: pages += ['/demo/settings/documents', '/demo/documents/pd-con-pc1', '/demo/documents/pd-up-pc7', '/demo/esign/pv1', '/demo/esign/pv2', '/demo/esign/pv1/sign/pv1-s2', '/demo/esign?doc=pd-sa-pe3']
    # ---- end documents and signatures ----
    # ---- leads and clients (appended by the leads and clients module): the pipeline settings, a won lead (what it created),
    # a lost lead, a lead that needs attention, and a client page with owners, contacts and opt-outs. Fixed ids of the sample firm.
    if practice: pages += ['/demo/settings/pipeline', '/demo/leads/pl8', '/demo/leads/pl10', '/demo/leads/pl12', '/demo/leads/pl6', '/demo/clients/pc6', '/demo/clients/pc8', '/demo/clients/pc13']
    # ---- end leads and clients ----
    # ---- automations, reviews and the assistant (appended by the automation module): the rule builder empty and with a coded
    # rule open in it, and the full run history, in every edition; in the practice edition also a rule that is plain data, and
    # the page a client answers a review request on (rv3 is a fixed id of the sample firm).
    pages += ['/demo/automations/history', '/demo/automations/new', '/demo/automations/rule/lead-intake']
    if practice: pages += ['/demo/automations/rule/p-appt-noshow', '/review/sample-rv3']
    # ---- end automations, reviews and the assistant ----
    # detail pages: follow the first record of each list
    details = [('/demo/leads', '/demo/leads/'), ('/demo/clients', '/demo/clients/'), ('/demo/jobs', '/demo/jobs/'), ('/demo/documents', '/demo/documents/')]
    if workers: details.append(('/demo/team', '/demo/team/'))
    checked = 0
    async def check(path):
        nonlocal checked
        errs.clear()
        await pg.goto(BASE + path)
        try:
            await pg.wait_for_selector('#main h1, main h1, h1', timeout=8000)
        except Exception:
            results.append({'pack': pack['id'], 'lang': lang, 'size': size_name, 'path': path, 'issue': 'no heading rendered'}); return
        await pg.wait_for_timeout(250)
        checked += 1
        info = await pg.evaluate("""() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, text: document.body.innerText, side: (document.querySelector('.side-brand') || {}).innerText || '', title: document.title, lang: document.documentElement.lang })""")
        def add(issue, detail=''):
            results.append({'pack': pack['id'], 'lang': lang, 'size': size_name, 'path': path, 'issue': issue, 'detail': detail[:240]})
        text = info['text']
        if errs: add('console error', ' | '.join(errs[:3]))
        if info['sw'] > info['iw'] + 1: add('sideways scroll', f"{info['sw']} > {info['iw']}")
        for m in KEY_RE.finditer(text):
            s = m.group(0)
            if re.search(r'\.(com|org|net|js|css|html|pdf|csv|json|png|jpg)$', s): continue
            add('untranslated key', text[max(0, m.start() - 30):m.end() + 20].replace('\n', ' ')); break
        m = TOKEN_RE.search(text)
        if m: add('unfilled token', text[max(0, m.start() - 30):m.end() + 20].replace('\n', ' '))
        m = DASH_RE.search(text)
        if m: add('long dash in sentence', text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' '))
        if info['lang'] != lang: add('html lang', info['lang'])
        workspace = path.startswith('/demo')
        if workspace:
            if size_name == 'desktop' and pack['product'] not in info['side']: add('product name missing in sidebar', info['side'][:80])
            if size_name == 'desktop' and pack['company'] not in info['side']: add('sample company missing in sidebar', info['side'][:80])
            for wd in BANNED[lang]:
                if wd in pack['allowed'][lang]: continue
                mm = word_re(wd).search(text)
                if mm: add('BUILD word in this edition: ' + wd, text[max(0, mm.start() - 40):mm.end() + 30].replace('\n', ' '))
        if lang == 'es':
            hits = []
            es_text = re.sub(r'Google Calendar|Add to Google|VYNTEX [A-Z]+|Sample [A-Z][\w&\' -]+|W-9|, Unit \w+(?=,)|[A-Z][a-z]+ [A-Z][a-z]+ (LLC|Inc|Co)\b', ' ', text)
            for mm in EN_RE.finditer(es_text):
                ctxt = es_text[max(0, mm.start() - 25):mm.end() + 25].replace('\n', ' ')
                hits.append(mm.group(0) + ' :: ' + ctxt)
                if len(hits) >= 3: break
            if hits: add('English left in Spanish', ' || '.join(hits))
        return text

    for p in pages:
        await check(p)
    for lst, prefix in details:
        await pg.goto(BASE + lst); await pg.wait_for_timeout(500)
        href = await first_href(pg, prefix)
        if not href:
            results.append({'pack': pack['id'], 'lang': lang, 'size': size_name, 'path': lst, 'issue': 'no record link found for ' + prefix}); continue
        await check(href)
        if prefix == '/demo/jobs/':
            for tab in (['team'] if workers else []) + ['money', 'tasks', 'documents', 'log', 'activity']:
                await check(href + '/' + tab)
        # the client page of the professional-services edition has tabs
        if prefix == '/demo/clients/' and practice:
            for tab in ['engagements', 'appointments', 'tasks', 'documents', 'billing', 'communications', 'notes', 'opportunities', 'activity', 'secure']:
                await check(href + '/' + tab)
    # the read-only role: every screen opens and nothing breaks
    if practice:
        await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = 'readonly'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
        for p in ['/demo', '/demo/leads', '/demo/clients', '/demo/jobs', '/demo/tasks', '/demo/payments']:
            await check(p)
        await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = 'owner'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }")
    # worker portal
    await pg.goto(BASE + '/demo'); await pg.wait_for_timeout(300)
    wid = None if not workers else await pg.evaluate("() => { const d = JSON.parse(localStorage.getItem('vyntex.demo.' + JSON.parse(localStorage.getItem('vyntex.prefs')).pack) || 'null'); return d && d.workers[0] ? d.workers[0].id : null; }")
    if wid:
        await pg.evaluate("(id) => { const p = JSON.parse(localStorage.getItem('vyntex.prefs')); p.viewAs = 'worker:' + id; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); }", wid)
        await check('/demo')
    await ctx.close()
    return checked

async def main():
    packs = [p for p in FACTS if not ONLY or p['id'] in ONLY]
    results = []; total = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        for pack in packs:
            for lang in ['en', 'es']:
                for name, w, h in SIZES:
                    n = await run(pack, lang, name, w, h, b, results)
                    total += n
                    print(f"{pack['id']:10} {lang} {name:8} pages={n} issues so far={len(results)}", flush=True)
        await b.close()
    out = os.path.join(ROOT, '.qa-matrix-' + ('-'.join(ONLY) or 'all') + '.json')
    json.dump({'pages': total, 'issues': results}, open(out, 'w'), indent=1)
    print('pages checked:', total, 'issues:', len(results))

asyncio.run(main())
