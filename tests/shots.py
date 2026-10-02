# Usage: python3 tests/shots.py <outdir> <width> <height> <query> <path1> <path2> ...   (query like "industry=clean&lang=es", or "-")
import sys, asyncio, os, re
from playwright.async_api import async_playwright
async def main():
    out, w, h, q = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    paths = sys.argv[5:]
    os.makedirs(out, exist_ok=True)
    base = 'http://localhost:' + os.environ.get('PORT', '4173')
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        ctx = await b.new_context(viewport={'width': w, 'height': h})
        pg = await ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'fonts' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        if q != '-':
            await pg.goto(base + '/demo?' + q); await pg.wait_for_timeout(400)
        for path in paths:
            await pg.goto(base + path); await pg.wait_for_timeout(600)
            name = re.sub(r'[^a-z0-9]+', '_', path.lower()).strip('_') or 'home'
            await pg.screenshot(path=f'{out}/{name}.png', full_page=os.environ.get('FULL') == '1')
        print('errors:', errs)
        await b.close()
asyncio.run(main())
