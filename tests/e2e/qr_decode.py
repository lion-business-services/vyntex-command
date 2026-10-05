# Reads QR symbols back with OpenCV, to check the encoder of the sign-in pages against an independent decoder.
# Input: a JSON file of { "text": ..., "m": [[0|1, ...], ...] } (dark modules are 1, no quiet border).
# Usage: python3 tests/e2e/qr_decode.py <cases.json>     (called by tests/e2e/qr_check.mjs)
import json, sys
import cv2
import numpy as np

cases = json.load(open(sys.argv[1]))
# two readers with different ways of finding the symbol in the picture; either reading the exact text counts
detectors = [cv2.QRCodeDetector()] + ([cv2.QRCodeDetectorAruco()] if hasattr(cv2, 'QRCodeDetectorAruco') else [])
bad = 0
for case in cases:
    m = np.array(case['m'], dtype=np.uint8)
    n = m.shape[0]
    got = ''
    # OpenCV's first reader misses some large symbols at one drawing size and reads them at another: a few sizes are tried
    for detector in detectors:
        for scale in (8, 6, 10, 5, 12, 4):
            quiet = 4
            side = (n + 2 * quiet) * scale
            img = np.full((side, side), 255, dtype=np.uint8)
            for r in range(n):
                for c in range(n):
                    if m[r][c]:
                        img[(r + quiet) * scale:(r + quiet + 1) * scale, (c + quiet) * scale:(c + quiet + 1) * scale] = 0
            try:
                got, _, _ = detector.detectAndDecode(img)
            except cv2.error:
                got = ''
            if got == case['text']:
                break
        if got == case['text']:
            break
    ok = got == case['text']
    bad += 0 if ok else 1
    print(('ok   ' if ok else 'WRONG') + ' version %2d, %3d bytes' % ((n - 17) // 4, len(case['text'].encode('utf-8'))) + ('' if ok else '  read: ' + repr(got[:50])))
print('%d of %d symbols read back to the same text' % (len(cases) - bad, len(cases)))
sys.exit(1 if bad else 0)
