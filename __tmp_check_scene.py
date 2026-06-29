from playwright.sync_api import sync_playwright
import sys

url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8011/gas-leak-demo'
errors = []
warnings = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda msg: warnings.append(f"{msg.type}: {msg.text}") if msg.type == 'warning' else None)
    page.goto(url, wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(3000)
    page.screenshot(path='F:\\code\\ue\\pixel_test1\\__tmp_scene.png', full_page=True)
    browser.close()

print(f"Loaded {url}")
print(f"Errors: {len(errors)}")
for e in errors[:20]:
    print('  ', e)
print(f"Warnings: {len(warnings)}")
for w in warnings[:20]:
    print('  ', w)
