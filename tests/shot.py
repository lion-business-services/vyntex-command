# Usage: python3 tests/shot.py <path> <out.png> [width] [height] [lang] [theme] [full]
import sys, asyncio
from playwright.async_api import async_playwright
async def main():
    path, out = sys.argv[1], sys.argv[2]
    w = int(sys.argv[3]) if len(sys.argv) > 3 else 1440; h = int(sys.argv[4]) if len(sys.argv) > 4 else 900
    full = len(sys.argv) > 7 and sys.argv[7] == 'full'
    base = 'http://localhost:' + (__import__('os').environ.get('PORT', '4173'))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        pg = await b.new_page(viewport={'width': w, 'height': h})
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        await pg.goto(base + path); await pg.wait_for_timeout(700)
        await pg.screenshot(path=out, full_page=full)
        print('errors:', [e for e in errs if 'fonts' not in e and 'ERR_FAILED' not in e])
        await b.close()
asyncio.run(main())
