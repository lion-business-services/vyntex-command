# End-to-end flows of the communications center, the integrations screen and the social module, in the sample workspace of
# the professional-services edition: the inbox (unread, reply, drafts, consent, notes, calls, assign, done, filters, a lead
# and a task from a conversation, links from other pages, the client tab), the settings section, roles, the honest states
# (nothing is ever sent, connected or published in a sample), the return from a provider, and posts from draft to "published
# in the sample".
# Usage: PORT=4690 python3 tests/qa_comms.py [lang]          VYNTEX Command, /demo?industry=practice
#        PORT=4690 NS=lbs python3 tests/qa_comms.py [lang]   LBS Command built with VX_SAMPLE_PREVIEW=1, /preview
# Takes about three minutes. Exits with an error code when a check fails.
import asyncio, json, os, sys
from playwright.async_api import async_playwright
PORT = os.environ.get('PORT', '4173')
NS = os.environ.get('NS', 'vyntex')
LANG = sys.argv[1] if len(sys.argv) > 1 else 'en'
BASE = 'http://localhost:' + PORT
ROOT = '/preview' if NS == 'lbs' else '/demo'
R = []
def rec(name, ok, detail=''):
    R.append((name, bool(ok), str(detail)[:200]))
    if not ok: print('  FAIL', name, detail, flush=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        ctx = await b.new_context(viewport={'width': 1440, 'height': 1000})
        pg = await ctx.new_page(); errs = []; pg.set_default_timeout(8000)
        pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text and 'net::ERR' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:300]))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        await pg.goto(BASE + ROOT + ('?lang=' + LANG if NS == 'lbs' else f'?industry=practice&lang={LANG}')); await pg.wait_for_selector('#main h1')
        await pg.evaluate("(ns) => { const k = ns + '.prefs'; const p = JSON.parse(localStorage.getItem(k)); p.tourSeen = true; localStorage.setItem(k, JSON.stringify(p)); }", NS)
        async def data(): return await pg.evaluate("(ns) => JSON.parse(localStorage.getItem(ns + '.demo.practice'))", NS)
        async def role(r):
            await pg.evaluate("([ns, r]) => { const k = ns + '.prefs'; const p = JSON.parse(localStorage.getItem(k)); p.viewAs = r; localStorage.setItem(k, JSON.stringify(p)); }", [NS, r])
        async def go(path):
            await pg.goto(BASE + ROOT + path)
            try: await pg.wait_for_selector('#main h1', timeout=6000)
            except Exception: await pg.wait_for_selector('#main')
            await pg.wait_for_timeout(700)
        t = lambda sel: pg.locator(sel)

        # ---- inbox
        await go('/messages')
        d = await data()
        rec('sample has conversations on several channels', len({m['channel'] for m in d['messages']}) >= 6, {m['channel'] for m in d['messages']})
        rec('no sample message claims a delivery', all(m['status'] in ('draft', 'demo', 'received') for m in d['messages']), {m['status'] for m in d['messages']})
        rec('no sample message names a provider', all('provider' not in m for m in d['messages']))
        rec('sample note shown', await t('[data-testid=messages-frame]').count() == 1)
        n = await t('[data-testid=messages-conv]').count()
        rec('conversation list rendered', n >= 8, n)
        unread0 = sum(1 for m in d['messages'] if m.get('dir') == 'in' and m.get('read') is False and m['channel'] != 'system')
        rec('one unread client message in the sample', unread0 == 1, unread0)
        # the first conversation is shown on a wide screen without being marked as read
        rec('thread shown on desktop', await t('[data-testid=messages-thread]').count() == 1)
        d2 = await data()
        rec('glancing does not mark as read', sum(1 for m in d2['messages'] if m['id'] == 'pm4' and m.get('read') is False) == 1)
        # open Gabriela: marks read
        await t('[data-testid=messages-conv][data-key=c_pc1]').click(); await pg.wait_for_timeout(500)
        d = await data()
        rec('opening marks read', next(m for m in d['messages'] if m['id'] == 'pm4')['read'] is True)
        rec('opening is not an edit of the sample', d['touched'] is False, d['touched'])
        rec('incoming labelled as sample record', await t('.messages-msg.in .badge').count() >= 1)
        rec('default channel is the one they wrote on', await t('[data-testid=messages-channel-whatsapp][aria-pressed=true]').count() == 1)
        rec('consent shown for WhatsApp', await t('[data-testid=messages-consent]').count() == 1)
        await t('[data-testid=messages-reply-body]').fill('See you at 11:30.')
        await t('[data-testid=messages-reply-send]').click(); await pg.wait_for_timeout(600)
        if await t('.modal [data-autofocus]').count(): await t('.modal [data-autofocus]').click(); await pg.wait_for_timeout(400)   # quiet hours confirm
        d = await data(); m = d['messages'][0]
        rec('reply stored as demo on whatsapp', m['channel'] == 'whatsapp' and m['status'] == 'demo' and m['body'] == 'See you at 11:30.' and m['to'] == '609-555-0931', m)
        rec('reply joined the thread', m['threadId'] == 'c:pc1:whatsapp' and m.get('clientId') == 'pc1', m.get('threadId'))
        rec('sample marker on the sent message', await t('.messages-msg.out[data-status=demo] .badge').count() >= 1)
        txt = await t('.messages-msg.out[data-status=demo]').last.inner_text()
        rec('marker wording', ('nothing was sent' in txt) or ('no se envió nada' in txt), txt[-80:])
        rec('client marked as contacted', bool(next(c for c in d['clients'] if c['id'] == 'pc1').get('lastContact')))
        # email channel for the same client: signature and template
        await t('[data-testid=messages-channel-email]').click(); await pg.wait_for_timeout(200)
        await t('[data-testid=messages-reply-template]').select_option('s:appt'); await pg.wait_for_timeout(200)
        subj = await t('[data-testid=messages-reply-subject]').input_value(); body = await t('[data-testid=messages-reply-body]').input_value()
        rec('template filled with the client and the next appointment', 'Gabriela' in body and '__________' not in body.split('\n')[4], body[:160])
        rec('signature previewed', await t('.messages-sig').count() == 1)
        await t('[data-testid=messages-reply-save]').click(); await pg.wait_for_timeout(400)
        d = await data(); m = d['messages'][0]
        rec('email draft saved with signature', m['status'] == 'draft' and m['channel'] == 'email' and m['subject'] == subj and 'Marisol Vega' in m['body'], m['body'][-80:])
        # review and send the draft from the thread
        await t('[data-testid=messages-review]').last.click(); await pg.wait_for_timeout(300)
        await t('.modal [data-testid=messages-send]').click(); await pg.wait_for_timeout(500)
        d = await data(); rec('draft sent from review: demo', next(x for x in d['messages'] if x['id'] == m['id'])['status'] == 'demo')

        # ---- consent: Teresa has not agreed to texts
        await t('[data-testid=messages-conv][data-key=c_pc2]').click(); await pg.wait_for_timeout(400)
        await t('[data-testid=messages-channel-text]').click(); await pg.wait_for_timeout(200)
        rec('text blocked without consent, with the reason', await t('[data-testid=messages-blocked]').count() == 1 and await t('[data-testid=messages-reply-send]').is_disabled())
        rec('system notice in the thread', await t('.messages-sys').count() >= 1)
        await t('[data-testid=messages-consent-btn]').click(); await pg.wait_for_timeout(300); await t('.modal [data-autofocus]').click(); await pg.wait_for_timeout(400)
        d = await data(); rec('consent recorded on the client', next(c for c in d['clients'] if c['id'] == 'pc2').get('smsOptIn') is True)
        rec('text allowed after consent', not await t('[data-testid=messages-reply-send]').is_disabled())
        # lead on WhatsApp without consent
        await t('[data-testid=messages-conv][data-key=l_pl4]').click(); await pg.wait_for_timeout(400)
        rec('lead: WhatsApp blocked without consent', await t('[data-testid=messages-channel-whatsapp][aria-pressed=true]').count() == 0 or await t('[data-testid=messages-blocked]').count() == 1)

        # ---- note and call
        await t('[data-testid=messages-conv][data-key=c_pc3]').click(); await pg.wait_for_timeout(400)
        await t('[data-testid=messages-composer] .seg button').nth(1).click(); await pg.wait_for_timeout(200)
        await t('[data-testid=messages-note-text]').fill('Ask Wei to call her on Monday.'); await t('[data-testid=messages-note-save]').click(); await pg.wait_for_timeout(400)
        d = await data(); c3 = next(c for c in d['clients'] if c['id'] == 'pc3')
        rec('internal note saved on the client, not as a message', c3['notes'][0]['text'] == 'Ask Wei to call her on Monday.' and c3['notes'][0]['kind'] == 'note' and not any('Ask Wei' in m['body'] for m in d['messages']))
        rec('note shown in the thread as internal', await t('.messages-note').count() >= 1)
        await t('[data-testid=messages-composer] .seg button').nth(2).click(); await pg.wait_for_timeout(200)
        await t('[data-testid=messages-call-minutes]').fill('4'); await t('[data-testid=messages-call-text]').fill('She will come next Tuesday.'); await t('[data-testid=messages-call-save]').click(); await pg.wait_for_timeout(400)
        d = await data(); c3 = next(c for c in d['clients'] if c['id'] == 'pc3')
        rec('call logged with duration', c3['notes'][0]['kind'] == 'call' and c3['notes'][0].get('seconds') == 240 and c3['notes'][0].get('dir') == 'out', c3['notes'][0])
        rec('call shown in the thread', await t('.messages-call').count() >= 1)
        rec('tel link is a plain tel: link', (await t('[data-testid=messages-tel]').get_attribute('href') or '').startswith('tel:'))

        # ---- assign and done
        await t('[data-testid=messages-assign]').select_option('u2'); await pg.wait_for_timeout(300)
        await t('[data-testid=messages-done-btn]').click(); await pg.wait_for_timeout(400)
        d = await data(); c3 = next(c for c in d['clients'] if c['id'] == 'pc3')
        rec('conversation assigned and done on the record', c3.get('comms', {}).get('assignee') == 'u2' and bool(c3.get('comms', {}).get('doneAt')), c3.get('comms'))
        rec('done conversation leaves the open list', await t('[data-testid=messages-conv][data-key=c_pc3]').count() == 0)
        await t('[data-testid=messages-filter-state] [data-view=done]').click(); await pg.wait_for_timeout(300)
        rec('done view lists it', await t('[data-testid=messages-conv][data-key=c_pc3]').count() == 1)
        await t('[data-testid=messages-filter-state] [data-view=open]').click(); await pg.wait_for_timeout(200)

        # ---- filters
        await t('[data-testid=messages-filter-channel]').select_option('facebook'); await pg.wait_for_timeout(300)
        keys = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=messages-conv]')].map(x => x.dataset.key)")
        rec('channel filter', keys == ['c_pc9'], keys)
        await t('[data-testid=messages-filter-channel]').select_option(''); await t('[data-testid=messages-filter-state] [data-view=reply]').click(); await pg.wait_for_timeout(300)
        keys = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=messages-conv]')].map(x => x.dataset.key)")
        rec('needs-reply view', 'l_pl4' in keys and 'c_pc1' not in keys, keys)
        await t('[data-testid=messages-filter-state] [data-view=all]').click(); await t('[data-testid=messages-filter-assigned]').select_option('u4'); await pg.wait_for_timeout(300)
        keys = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=messages-conv]')].map(x => x.dataset.key)")
        rec('assigned filter', 'c_pc9' in keys and 'c_pc1' not in keys, keys)
        await t('[data-testid=messages-filter-assigned]').select_option('')

        # ---- someone not on file -> lead
        key = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=messages-conv]')].map(x => x.dataset.key).find(k => k.startsWith('a_'))")
        await t(f'[data-testid=messages-conv][data-key="{key}"]').click(); await pg.wait_for_timeout(400)
        rec('unmatched conversation has no record link', await t('.messages-th a.messages-name').count() == 0)
        n_leads = len((await data())['leads'])
        await t('[data-testid=messages-lead]').click(); await pg.wait_for_timeout(300)
        await t('.modal input').nth(0).fill('Shore Sweets Sample'); await t('.modal input[type=tel]').fill('609-555-0188'); await t('.modal button[type=submit]').click(); await pg.wait_for_timeout(600)
        d = await data()
        rec('lead created from the conversation', len(d['leads']) == n_leads + 1 and d['leads'][0]['name'] == 'Shore Sweets Sample', d['leads'][0]['name'])
        # ---- task from a message
        await t('[data-testid=messages-conv][data-key=l_pl4]').click(); await pg.wait_for_timeout(400)
        n_tasks = len(d['tasks'])
        await t('[data-testid=messages-task]').click(); await pg.wait_for_timeout(300); await t('.modal button[type=submit]').click(); await pg.wait_for_timeout(500)
        d = await data(); rec('task created for the lead', len(d['tasks']) == n_tasks + 1 and d['tasks'][0].get('leadId') == 'pl4', d['tasks'][0])

        # ---- new message to a client with no history
        await t('[data-testid=messages-compose]').click(); await pg.wait_for_timeout(300)
        d = await data()
        jobs = {j['id']: j['clientId'] for j in d['jobs']}
        busy = {m.get('clientId') for m in d['messages']} | {m['ref'].get('id') for m in d['messages']} | {jobs.get(m['ref'].get('id')) for m in d['messages']}
        quiet = next((c for c in d['clients'] if c['id'] not in busy and not any(n['kind'] == 'call' for n in c['notes']) and c.get('officeId') != 'o2' and not any(m.get('to') == c['email'] for m in d['messages'])), None)
        if quiet:
            await t('.modal .searchbox input').fill(quiet['name']); await pg.wait_for_timeout(200); await t('[data-testid=messages-pick]').first.click(); await pg.wait_for_timeout(500)
            rec('a client with no messages opens on a thread without messages', ('c=c_' + quiet['id']) in pg.url and await t('.messages-tl .messages-msg').count() == 0 and await t('[data-testid=messages-composer]').count() == 1, pg.url)
        else:
            await t('[data-testid=messages-pick]').first.click(); await pg.wait_for_timeout(500); print('  note: every sample client has a conversation; empty thread not checked')
        await t('[data-testid=messages-reply-body]').fill('')
        await t('[data-testid=messages-reply-send]').click(); await pg.wait_for_timeout(300)
        rec('empty message refused', await t('[data-testid=messages-reply-error]').count() == 1)
        # links from other pages
        await go('/messages?open=pm20'); await pg.wait_for_timeout(400)
        rec('?open= opens the draft for review in its conversation', 'c=c_pc10' in pg.url and await t('.modal [data-testid=messages-send]').count() == 1, pg.url)
        await go('/messages?compose=pc7'); rec('?compose= opens that client', 'c=c_pc7' in pg.url, pg.url)
        # ---- client tab
        await go('/clients/pc1/communications'); rec('client tab shows the thread and composer', await t('[data-testid=messages-thread]').count() == 1 and await t('[data-testid=messages-composer]').count() == 1)

        # ---- settings
        await go('/settings/communications')
        rec('settings section renders', await t('[data-testid=messages-set-channels]').count() == 1)
        await t('[data-testid=messages-set-instagram]').click(); await pg.wait_for_timeout(300)
        d = await data(); rec('channel switched off in settings', d['settings']['messages']['channels']['instagram'] is False, d['settings'].get('messages'))
        await t('[data-testid=messages-set-copy-remind]').click(); await pg.wait_for_timeout(400)
        if await t('.modal').count(): await t('.modal button[type=submit]').click(); await pg.wait_for_timeout(300)
        d = await data(); tp = d['settings']['messages'].get('templates', [])
        rec('starter copied to the company templates with merge fields', len(tp) == 1 and '{{client.first}}' in tp[0]['body']['en'] and '{{client.first}}' in tp[0]['body']['es'], tp[:1])
        await go('/messages?c=c_pc1')
        rec('switched-off channel is not offered', await t('[data-testid=messages-channel-instagram]').count() == 0 and await t('[data-testid=messages-channel-email]').count() == 1)
        await t('[data-testid=messages-channel-text]').click(); await pg.wait_for_timeout(200)
        opts = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=messages-reply-template] option')].map(o => o.value)")
        rec('company template offered on its channel', any(o.startswith('t:') for o in opts), opts)

        # ---- roles
        await role('readonly'); await go('/messages?c=c_pc2')
        rec('read only: reads, cannot write', await t('[data-testid=messages-thread]').count() == 1 and await t('[data-testid=messages-composer]').count() == 0 and await t('[data-testid=messages-compose]').count() == 0 and await t('[data-testid=messages-review]').count() == 0)
        await role('staff'); await go('/messages')
        keys = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=messages-conv]')].map(x => x.dataset.key)")
        rec('associate of one office does not see the other office\'s clients', 'c_pc9' not in keys and 'c_pc1' in keys, keys)
        await go('/integrations'); rec('associate has no integrations screen', await t('[data-testid=integrations-card]').count() == 0)
        await go('/social'); rec('associate has no social screen', await t('[data-testid=social-new]').count() == 0)
        await role('owner')

        # ---- integrations
        await go('/integrations')
        cards = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=integrations-card]')].map(c => [c.dataset.provider, c.dataset.state])")
        rec('thirteen providers, none connected', len(cards) == 13 and all(s == 'not_connected' for _, s in cards), cards)
        text = await t('#main').inner_text()
        rec('the word Connected (state) is nowhere', 'Connected\n' not in text and 'Conectado\n' not in text)
        await t('[data-provider=gmail] [data-testid=integrations-connect]').click(); await pg.wait_for_timeout(400)
        rec('connect in a sample explains instead of connecting', await t('[data-provider=gmail] [data-testid=integrations-result][data-tone=note]').count() == 1 and '/integrations' in pg.url)
        await t('[data-provider=whatsapp] [data-testid=integrations-needs]').click(); await pg.wait_for_timeout(200)
        rec('what is needed panel', await t('[data-provider=whatsapp] [data-testid=integrations-need] li').count() == 5)
        rec('sandbox note on Square', await t('[data-provider=square] .integrations-mode').count() == 1 and await t('[data-provider=gmail] .integrations-mode').count() == 0)
        await go('/integrations?integration=gmail&result=error&reason=denied_at_provider')
        rec('return from the provider: error worded, address cleaned', await t('[data-testid=integrations-back][data-result=error]').count() == 1 and 'integration=' not in pg.url, pg.url)
        await go('/integrations?integration=gcal&result=connected')
        rec('return from the provider: success message', await t('[data-testid=integrations-back][data-result=ok]').count() == 1)
        cards = await pg.evaluate("() => [...document.querySelectorAll('[data-testid=integrations-card]')].map(c => c.dataset.state)")
        rec('a forged return address does not make a card connected', all(s == 'not_connected' for s in cards))

        # ---- social
        await go('/social')
        rec('social queue', await t('[data-testid=social-post]').count() == 5)
        rec('failed post shows its error and a retry', await t('[data-testid=social-failed]').count() == 1 and await t('[data-testid=social-retry]').count() == 1)
        await t('[data-testid=social-new]').click(); await pg.wait_for_timeout(300)
        await t('[data-testid=social-text]').fill('Flow test post')
        await t('[data-testid=social-channel-instagram]').click(); await pg.wait_for_timeout(200)
        await t('[data-testid=social-publish]').click(); await pg.wait_for_timeout(400)
        rec('Instagram without a picture is refused', await t('[data-testid=social-error]').count() == 1)
        await pg.set_input_files('[data-testid=social-file]', {'name': 'p.jpg', 'mimeType': 'image/jpeg', 'buffer': bytes.fromhex('ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f00fbfcffd9')}); await pg.wait_for_timeout(500)
        rec('picture attached, preview has no problem', await t('[data-testid=social-preview].bad').count() == 0 and await t('.social-pimg').count() >= 1)
        await t('[data-testid=social-publish]').click(); await pg.wait_for_timeout(500)
        d = await data(); p0 = d['posts'][0]
        rec('publish in a sample marks the post demo', p0['text'] == 'Flow test post' and p0['status'] == 'demo' and bool(p0.get('publishedAt')) and p0['media'][0]['mime'] == 'image/jpeg', {k: p0[k] for k in ('status', 'channels')})
        rec('no post is ever published in a sample', all(x['status'] != 'published' for x in d['posts']))
        await t('.social-bar .seg button').nth(2).click(); await pg.wait_for_timeout(300)
        rec('history lists it with the sample marker', await t('[data-testid=social-history] [data-status=demo]').count() == 2)
        await t('.social-bar .seg button').nth(1).click(); await pg.wait_for_timeout(300)
        rec('calendar shows scheduled posts', await t('[data-testid=social-calendar] .social-chip').count() >= 2, await t('[data-testid=social-calendar] .social-chip').count())
        await t('.social-bar .seg button').nth(3).click(); await pg.wait_for_timeout(300)
        rec('reviews: honest empty state', await t('.empty').count() == 1 and await t('[data-testid=social-post]').count() == 0)
        await t('.social-bar .seg button').nth(0).click(); await pg.wait_for_timeout(300)
        await t('[data-status=needs_approval] [data-testid=social-approve]').click(); await pg.wait_for_timeout(400)
        d = await data(); rec('owner approves', next(x for x in d['posts'] if x['id'] == 'sp2').get('approvedBy') == 'u1')
        await t('[data-status=failed] [data-testid=social-retry]').click(); await pg.wait_for_timeout(400)
        d = await data(); rec('retry of a failed post', next(x for x in d['posts'] if x['id'] == 'sp6')['status'] == 'demo')
        # the company can switch the social screen off (Settings, Screens): the screen leaves the menu and the posts are kept
        await pg.evaluate("(ns) => { const k = ns + '.demo.practice'; const d = JSON.parse(localStorage.getItem(k)); d.config = { ...d.config, modules: { ...(d.config.modules || {}), social: false } }; localStorage.setItem(k, JSON.stringify(d)); }", NS)
        await go('/messages')
        d = await data()
        rec('social switched off for the company: out of the menu, posts kept', await pg.locator('nav a[href$="/social"]').count() == 0 and len(d['posts']) >= 6)
        await pg.evaluate("(ns) => { const k = ns + '.demo.practice'; const d = JSON.parse(localStorage.getItem(k)); d.config.modules.social = true; localStorage.setItem(k, JSON.stringify(d)); }", NS)
        await go('/messages'); rec('and back', await pg.locator('nav a[href$="/social"]').count() == 1)

        # ---- notices and the prefilled composer (begin; appended by the QA pass)
        # a rule's "notify" step writes a system notice for someone in the office: the inbox lists those under Notices,
        # never as a conversation with the rule's id for a name
        # the flows above opened conversations and so read their notices: put the rules' notices back to unread first
        await pg.evaluate("(ns) => { const k = ns + '.demo.practice'; const d = JSON.parse(localStorage.getItem(k)); for (const m of d.messages) if (m.channel === 'system' && m.auto) m.read = false; localStorage.setItem(k, JSON.stringify(d)); }", NS)
        await go('/messages')
        d = await data(); sysn = [m for m in d['messages'] if m['channel'] == 'system']
        rec('sample has notices from the rules', len(sysn) >= 2 and any(m.get('auto') for m in sysn), len(sysn))
        rec('no conversation is named after a rule', await t('[data-testid=messages-conv][data-key^="a_p-"]').count() == 0)
        await t('[data-view=notices]').click(); await pg.wait_for_timeout(300)
        rec('notices view lists every notice', await t('[data-testid=messages-notice]').count() == len(sysn), [await t('[data-testid=messages-notice]').count(), len(sysn)])
        unread_n = sum(1 for m in sysn if m.get('read') is False)
        rec('unread notices are marked', await t('[data-testid=messages-notice][data-read=no]').count() == unread_n and unread_n >= 1, unread_n)
        rec('notices say nothing was sent outside', await t('.messages-nhead').count() == 1)
        await t('[data-testid=messages-notice][data-read=no]').first.click(); await pg.wait_for_timeout(500)
        d = await data(); rec('opening a notice reads it and goes to what it is about', sum(1 for m in d['messages'] if m['channel'] == 'system' and m.get('read') is False) < unread_n and ('/messages?c=' in pg.url or '/tasks' in pg.url), pg.url)
        await go('/messages'); await t('[data-view=notices]').click(); await pg.wait_for_timeout(300)
        if unread_n > 1:
            await t('[data-testid=messages-notices-read]').click(); await pg.wait_for_timeout(300)
            d = await data(); rec('mark all notices as read', not any(m['channel'] == 'system' and m.get('read') is False for m in d['messages']))
        await role('readonly'); await go('/messages'); await t('[data-view=notices]').click(); await pg.wait_for_timeout(300)
        # a read-only person sees the notices of the clients they may see (a client of another office stays out, as in the list)
        n_ro = await t('[data-testid=messages-notice]').count()
        rec('read only: notices listed, nothing to mark', 1 <= n_ro <= len(sysn) and await t('[data-testid=messages-notices-read]').count() == 0, [n_ro, len(sysn)])
        await role('owner')
        # a link from another page: /messages?compose=1&to=<client>&subject=..&body=..
        n0 = len((await data())['messages'])
        await go('/messages?compose=1&to=pc2&subject=Link%20for%20you&body=https%3A%2F%2Fexample.com%2Fbooks')
        rec('compose link opens that client', pg.url.endswith('/messages?c=c_pc2'), pg.url)
        rec('compose link fills the subject and the text', await t('[data-testid=messages-reply-subject]').input_value() == 'Link for you' and await t('[data-testid=messages-reply-body]').input_value() == 'https://example.com/books')
        await t('[data-testid=messages-reply-send]').click(); await pg.wait_for_timeout(500)
        d = await data(); m0 = d['messages'][0]
        rec('prefilled message ends as a sample, nothing sent', len(d['messages']) == n0 + 1 and m0['status'] == 'demo' and m0['subject'] == 'Link for you' and 'provider' not in m0, m0.get('status'))
        rec('and it carries the visible nothing-was-sent marker', await t('.messages-msg[data-status=demo] .badge').count() >= 1)
        await go('/messages?compose=1&subject=Link%20for%20you&body=https%3A%2F%2Fexample.com%2Fpay')
        rec('compose link without a client asks who it is for', await t('[data-testid=messages-pick]').count() >= 1)
        await t('[data-testid=messages-pick]').first.click(); await pg.wait_for_timeout(600)
        rec('and keeps the text for the person picked', await t('[data-testid=messages-reply-body]').input_value() == 'https://example.com/pay')
        await t('[data-testid=messages-conv]').nth(4).click(); await pg.wait_for_timeout(500)
        rec('the started text does not follow to another conversation', await t('[data-testid=messages-reply-body]').input_value() == '')
        # ---- notices and the prefilled composer (end)

        rec('no console errors', not errs, errs[:3])
        await b.close()
    bad = [r for r in R if not r[1]]
    print(f'{len(R) - len(bad)}/{len(R)} checks passed')
    for n, ok, dt in bad: print('FAILED:', n, '|', dt)
    return 1 if bad else 0
sys.exit(asyncio.run(main()))
