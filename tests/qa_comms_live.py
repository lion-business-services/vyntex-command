# The Integrations, Messages and Social screens as a LIVE workspace, against a stand-in for the server
# (tests/harness/comms_live.tsx). No server and no provider is involved: the stand-in answers the gateway contract with the
# shapes docs/SERVER.md describes, and this test checks what the screens do with every state a server can report:
# the seven connection states and their reasons, connect through the identity check and the return from the provider,
# test, sync, disconnect; a message that is sent is marked `queued` (never sent or delivered) and a channel without a
# connection cannot be used; a post is handed over as `scheduled` (never published) and a network without a connection
# cannot be picked.
# Usage: node tests/harness/build_comms_live.mjs /tmp/<your build> && PORT=<port> python3 tests/qa_comms_live.py
import asyncio, os, sys
from playwright.async_api import async_playwright
BASE = 'http://localhost:' + os.environ.get('PORT', '4173') + '/harness-comms/index.html'
R = []
def rec(name, ok, detail=''):
    R.append((name, bool(ok), str(detail)[:240]))
    if not ok: print('  FAIL', name, detail, flush=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        ctx = await b.new_context(viewport={'width': 1440, 'height': 1000})
        pg = await ctx.new_page(); errs = []; pg.set_default_timeout(8000)
        pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'fonts' not in m.text and 'net::ERR' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:300]))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        t = lambda sel: pg.locator(sel)
        card = lambda pid: f'[data-testid=integrations-card][data-provider={pid}]'
        async def go(page, extra=''): await pg.goto(BASE + '?page=' + page + extra); await pg.wait_for_selector('#main h1'); await pg.wait_for_timeout(600)

        # ---- integrations: every state, with the reason the server gave
        await go('integrations')
        states = dict(await pg.evaluate("() => [...document.querySelectorAll('[data-testid=integrations-card]')].map(c => [c.dataset.provider, c.dataset.state])"))
        rec('each card shows the state the server sent', states == {'gmail': 'setup', 'resend': 'connected', 'gcal': 'pending_approval', 'gmeet': 'not_connected', 'gbp': 'not_connected', 'gmaps': 'not_connected', 'square': 'connected', 'quickbooks': 'reauth', 'whatsapp': 'attention', 'meta': 'error', 'dialpad': 'not_connected', 'sms': 'setup', 'ai': 'connected'}, states)
        rec('no sample notice in a live workspace', await t('[data-testid=integrations-sample]').count() == 0)
        labels = {pid: (await t(card(pid) + ' header .badge').inner_text()) for pid in ['gmail', 'resend', 'gcal', 'gmeet', 'quickbooks', 'whatsapp', 'meta']}
        rec('the six states of the brief, and pending approval, are worded', labels == {'gmail': 'Connect during setup', 'resend': 'Connected', 'gcal': 'Pending provider approval', 'gmeet': 'Not connected', 'quickbooks': 'Reauthorization required', 'whatsapp': 'Attention required', 'meta': 'Error'}, labels)
        rec('connected card: account, permissions, last sync, who connected', 'notices@harness.example.com' in await t(card('resend')).inner_text() and 'emails.send' in await t(card('resend')).inner_text() and 'Test Owner' in await t(card('resend')).inner_text())
        rec('a card that is not connected shows no account', await t(card('gmail') + ' [data-testid=integrations-account]').count() == 0)
        rec('missing settings are named', 'GOOGLE_CLIENT_ID' in await t(card('gmeet')).inner_text())
        rec('pending approval carries the server\'s note', 'reviews and approves' in await t(card('gcal')).inner_text() and await t(card('gcal') + ' [data-testid=integrations-connect]').count() == 0)
        rec('a reason code without wording is shown as it came', 'made_up_code' in await t(card('dialpad') + ' [data-testid=integrations-reason]').inner_text())
        rec('last error shown when it adds something', 'could not be reached' in await t(card('whatsapp')).inner_text())
        rec('sandbox mode is flagged', 'Sandbox' in await t(card('square') + ' .integrations-mode').inner_text())
        rec('actions follow the state', await t(card('resend') + ' [data-testid=integrations-test]').count() == 1 and await t(card('resend') + ' [data-testid=integrations-sync]').count() == 1 and await t(card('resend') + ' [data-testid=integrations-disconnect]').count() == 1
            and await t(card('gmail') + ' [data-testid=integrations-disconnect]').count() == 0 and await t(card('gmeet') + ' [data-testid=integrations-connect]').count() == 0 and await t(card('quickbooks') + ' [data-testid=integrations-connect]').count() == 1)
        # test and sync
        await t(card('whatsapp') + ' [data-testid=integrations-test]').click(); await pg.wait_for_timeout(500)
        rec('test: a failing check is reported with its reason', await t(card('whatsapp') + ' [data-testid=integrations-result][data-tone=bad]').count() == 1)
        await t(card('square') + ' [data-testid=integrations-test]').click(); await pg.wait_for_timeout(500)
        rec('test: a working connection says so', await t(card('square') + ' [data-testid=integrations-result][data-tone=ok]').count() == 1)
        await t(card('resend') + ' [data-testid=integrations-sync]').click(); await pg.wait_for_timeout(500)
        rec('sync now is asked of the server', 'sync:resend' in await pg.evaluate('window.__calls'))
        # connect: the server asks for the identity check; a wrong password is refused; then the browser is sent to the provider and comes back
        await t(card('gmail') + ' [data-testid=integrations-connect]').click(); await pg.wait_for_timeout(500)
        rec('connect asks to confirm identity when the server requires it', await t('[data-testid=integrations-identity]').count() == 1)
        await t('#int-identity').fill('wrong'); await t('[data-testid=integrations-identity] button[type=submit]').click(); await pg.wait_for_timeout(400)
        rec('a wrong password is refused and nothing is connected', await t('[data-testid=integrations-identity] [role=alert]').count() == 1 and await t(card('gmail')).get_attribute('data-state') == 'setup')
        rec('the field is emptied after the attempt', await t('#int-identity').input_value() == '')
        await t('#int-identity').fill('harness-pass'); await t('[data-testid=integrations-identity] button[type=submit]').click()
        await pg.wait_for_selector('[data-testid=integrations-back]'); await pg.wait_for_timeout(500)
        rec('back from the provider: message, clean address, card connected with its account', await t('[data-testid=integrations-back][data-result=ok]').count() == 1 and 'integration=' not in pg.url
            and await t(card('gmail')).get_attribute('data-state') == 'connected' and 'office@harness.example.com' in await t(card('gmail') + ' [data-testid=integrations-account]').inner_text(), pg.url)
        # disconnect: confirmation, identity check, then the card goes back to "connect during setup"
        await t(card('square') + ' [data-testid=integrations-disconnect]').click(); await pg.wait_for_timeout(300)
        await t('.modal [data-autofocus]').click(); await pg.wait_for_timeout(400)
        rec('disconnect asks to confirm identity', await t('[data-testid=integrations-identity]').count() == 1)
        await t('.modal .iconbtn').first.click(); await pg.wait_for_timeout(400)
        rec('closing the identity check changes nothing', await t(card('square')).get_attribute('data-state') == 'connected')
        await t(card('square') + ' [data-testid=integrations-disconnect]').click(); await pg.wait_for_timeout(300); await t('.modal [data-autofocus]').click(); await pg.wait_for_timeout(300)
        await t('#int-identity').fill('harness-pass'); await t('[data-testid=integrations-identity] button[type=submit]').click(); await pg.wait_for_timeout(700)
        rec('disconnected card', await t(card('square')).get_attribute('data-state') == 'setup' and await t(card('square') + ' [data-testid=integrations-account]').count() == 0)
        await go('integrations', '&integration=meta&result=error&reason=denied_at_provider')
        rec('a refusal at the provider is worded', 'declined' in await t('[data-testid=integrations-back][data-result=error]').inner_text())

        # ---- messages in a live workspace
        await go('messages')
        rec('no sample notice and no sample tags', await t('[data-testid=messages-frame]').count() == 0)
        await t('[data-testid=messages-conv]').first.click(); await pg.wait_for_timeout(500)
        thread = await t('[data-testid=messages-thread]').inner_text()
        rec('server states are shown as they are', 'Delivered' in thread and 'Not delivered' in thread and 'The carrier refused the number.' in thread and 'Sample' not in thread, thread[-200:])
        rec('opening marks the message read, sent as a change', any(o.get('c') == 'messages' and o.get('id') == 'm1' and o['row'].get('read') is True for o in await pg.evaluate('window.__ops')) or (await pg.wait_for_timeout(900)) is None and any(o.get('c') == 'messages' and o.get('id') == 'm1' and o['row'].get('read') is True for o in await pg.evaluate('window.__ops')))
        await t('[data-testid=messages-channel-text]').click(); await pg.wait_for_timeout(200)
        rec('text: consent is on record but nothing is connected, so it cannot be sent', await t('[data-testid=messages-blocked]').count() == 1 and await t('[data-testid=messages-reply-send]').is_disabled())
        await t('[data-testid=messages-channel-email]').click(); await pg.wait_for_timeout(200)
        await t('[data-testid=messages-reply-subject]').fill('Friday'); await t('[data-testid=messages-reply-body]').fill('See you on Friday.')
        await t('[data-testid=messages-reply-send]').click(); await pg.wait_for_timeout(1200)
        d = await pg.evaluate('window.__data()'); m = d['messages'][0]
        rec('send in a live workspace marks the message queued, nothing more', m['status'] == 'queued' and m['subject'] == 'Friday', m['status'])
        sent = [o for o in await pg.evaluate('window.__ops') if o.get('c') == 'messages' and o.get('id') == m['id']]
        rec('the queued message travels to the server as one change', len(sent) >= 1 and sent[-1]['row']['status'] == 'queued' and sent[-1]['row']['channel'] == 'email' and sent[-1]['row']['to'] == 'dana@example.com', sent[-1]['row'] if sent else None)
        rec('it reads "Queued to send", not sent', 'Queued to send' in await t('.messages-msg.out').last.inner_text())

        # ---- social in a live workspace
        await go('social')
        strip = await t('[data-testid=social-accounts]').inner_text()
        rec('connected account named only where the server said so', 'Connect first' in strip, strip[:160])
        await t('[data-testid=social-new]').click(); await pg.wait_for_timeout(300)
        rec('a network without a connection cannot be picked', await t('[data-testid=social-channel-facebook]').is_disabled() and await t('[data-testid=social-channel-gbp]').is_disabled())
        await t('.modal .iconbtn').first.click(); await pg.wait_for_timeout(200)
        rec('failed post from the server shows its error and a retry', 'The Page token was refused.' in await t('[data-testid=social-failed]').inner_text() and await t('[data-testid=social-retry]').count() == 1)
        await t('[data-testid=social-retry]').click(); await pg.wait_for_timeout(1000)
        d = await pg.evaluate('window.__data()'); p2 = next(x for x in d['posts'] if x['id'] == 'p2')
        rec('retry hands the post to the server as scheduled for now, never as published', p2['status'] == 'scheduled' and bool(p2.get('scheduledFor')) and not p2.get('publishedAt'), p2['status'])
        await t('.social-bar .seg button').nth(2).click(); await pg.wait_for_timeout(300)
        rec('history shows what the server published', await t('[data-testid=social-history] [data-status=published]').count() == 1)
        rec('no console errors', not errs, errs[:3])
        await b.close()
    bad = [r for r in R if not r[1]]
    print(f'{len(R) - len(bad)}/{len(R)} checks passed')
    for n, ok, dt in bad: print('FAILED:', n, '|', dt)
    return 1 if bad else 0
sys.exit(asyncio.run(main()))
