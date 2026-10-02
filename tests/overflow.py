# Usage: python3 tests/overflow.py <path> [width] [query]  -> lists elements wider than the viewport
import sys, asyncio, os
from playwright.async_api import async_playwright
async def main():
    path = sys.argv[1]; w = int(sys.argv[2]) if len(sys.argv) > 2 else 390; q = sys.argv[3] if len(sys.argv) > 3 else ''
    base = 'http://localhost:' + os.environ.get('PORT', '4173')
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        pg = await b.new_page(viewport={'width': w, 'height': 844})
        await pg.route('**/fonts.g*/**', lambda r: r.abort())
        if q: await pg.goto(base + '/demo?' + q); await pg.wait_for_timeout(500)
        await pg.goto(base + path); await pg.wait_for_timeout(900)
        out = await pg.evaluate("""() => { const iw = window.innerWidth; const res = []; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > iw + 1 && getComputedStyle(el).position !== 'fixed') { let p = el.parentElement, clipped = false; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'hidden' || o === 'scroll') { clipped = true; break; } p = p.parentElement; } if (!clipped) res.push(el.tagName + '.' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width) + ' :: ' + (el.innerText || '').slice(0, 50).replace(/\\n/g, ' ')); } } return [document.documentElement.scrollWidth, ...res.slice(0, 12)]; }""")
        for o in out: print(o)
        await b.close()
asyncio.run(main())
