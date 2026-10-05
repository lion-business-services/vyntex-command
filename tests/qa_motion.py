# Reduced-motion and keyboard checks on the built site: with motion reduced nothing animates and no text stays faded out;
# Tab reaches the controls and each shows a focus ring; the command palette opens, navigates and closes from the keyboard.
# Usage: python3 tests/qa_motion.py   (PORT env selects the preview server)
import asyncio, os
from playwright.async_api import async_playwright
BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
OK = []; BAD = []
def rec(name, ok, detail=''):
    (OK if ok else BAD).append(name); 
    if not ok: print('FAIL', name, detail)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        # 1. reduced motion: the overview page is complete and still
        for w, h in [(1440, 900), (390, 844)]:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce'); pg = await ctx.new_page()
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.route('**/fonts.g*/**', lambda r: r.abort())
            for path in ['/', '/pricing', '/request-demo', '/demo']:
                await pg.goto(BASE + path); await pg.wait_for_timeout(900)
                total = await pg.evaluate("document.documentElement.scrollHeight")
                y = 0
                while y < total:
                    await pg.evaluate(f"window.scrollTo(0,{y})"); await pg.wait_for_timeout(120); y += h
                await pg.wait_for_timeout(500)
                r = await pg.evaluate("""() => {
                  const running = document.getAnimations().filter(a => a.playState === 'running').length;
                  const hidden = [...document.querySelectorAll('main *, .mk *')].filter(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 12 && e.children.length === 0 && (e.textContent || '').trim().length > 3 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[aria-hidden=true], [hidden], .sr-only, .vh') && (() => { let o = 1; for (let n = e; n && n !== document.body; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o < 0.3 })(); });
                  return { running, hidden: hidden.length, sample: hidden.slice(0, 3).map(e => (e.className || e.tagName) + ': ' + e.textContent.trim().slice(0, 40)) } }""")
                rec(f'reduced motion {path} {w}: nothing animating', r['running'] == 0, r['running'])
                rec(f'reduced motion {path} {w}: no text left faded out', r['hidden'] == 0, r['sample'])
            rec(f'reduced motion {w}: no page errors', not errs, errs[:2])
            await ctx.close()
        # 2. keyboard
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}); pg = await ctx.new_page()
        await pg.route('**/fonts.g*/**', lambda r: r.abort())
        for path in ['/', '/pricing', '/request-demo', '/demo']:
            await pg.goto(BASE + path); await pg.wait_for_timeout(900)
            seen = []
            for i in range(14):
                await pg.keyboard.press('Tab')
                f = await pg.evaluate("""() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName, text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none', vis: r.width > 0 && r.height > 0 } }""")
                if f: seen.append(f)
            rec(f'keyboard {path}: Tab reaches controls', len(seen) >= 10, len(seen))
            noring = [s for s in seen if not s['ring']]
            rec(f'keyboard {path}: every focused control shows a focus ring', not noring, noring[:3])
            if path == '/': print('first stops on /:', [s['text'] for s in seen[:8]])
        # command palette
        await pg.goto(BASE + '/demo'); await pg.wait_for_timeout(800)
        await pg.keyboard.press('Control+k'); await pg.wait_for_timeout(300)
        rec('Ctrl+K opens the command palette', await pg.locator('.palette').count() == 1)
        await pg.keyboard.type('leads'); await pg.wait_for_timeout(200); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        rec('palette: typing and Enter navigates', '/demo/leads' in pg.url, pg.url)
        await pg.keyboard.press('Control+k'); await pg.wait_for_timeout(200); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        rec('Escape closes the palette', await pg.locator('.palette').count() == 0)
        await ctx.close()
        await b.close()
    print('passed', len(OK), 'failed', len(BAD))
asyncio.run(main())
