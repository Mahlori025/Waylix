"""
Drive the Waylix web preview through its main flows and save phone-sized
screenshots. Prereqs: API on :8787 (seeded), web export served on :8081.

  python3 apps/mobile/web-preview/screenshots.py /tmp/wl-shot

External services the sandbox cannot reach are handled explicitly:
  - Photon search  -> answered from FIXTURE_PLACES below (clearly fake places list)
  - OSRM routing   -> aborted, so the app exercises its real offline fallback
"""
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screenshots")
OUT.mkdir(parents=True, exist_ok=True)
APP = "http://localhost:8081"

START = (28.0431, -26.1966)  # Braamfontein, south of the seeded pothole
END = (28.0456, -26.1896)
FIXTURE_PLACES = {
    "features": [
        {"geometry": {"coordinates": list(END)}, "properties": {"name": "Juta Street", "district": "Braamfontein", "city": "Johannesburg", "country": "South Africa", "osm_value": "residential"}},
        {"geometry": {"coordinates": [28.0429, -26.1897]}, "properties": {"name": "Constitution Hill", "district": "Braamfontein", "city": "Johannesburg", "country": "South Africa", "osm_value": "museum"}},
    ]
}
SETTINGS = {
    "reporterId": "anon-review-device",
    "apiUrl": "http://localhost:8787",
    "styleUrl": "https://tiles.openfreemap.org/styles/liberty",
    "driveRoutingUrl": "https://routing.openstreetmap.de/routed-car",
    "walkRoutingUrl": "https://routing.openstreetmap.de/routed-foot",
    "geocoderUrl": "https://photon.komoot.io",
    "voice": False, "autoDetectPotholes": False, "avoidHazards": True,
}
console = []


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--no-sandbox"])
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=False,
            geolocation={"longitude": START[0], "latitude": START[1], "accuracy": 6}, permissions=["geolocation"],
        )
        # Headless Chrome's emulated GPS only feeds watchPosition() reliably with enableHighAccuracy.
        ctx.add_init_script("const _w=navigator.geolocation.watchPosition.bind(navigator.geolocation);navigator.geolocation.watchPosition=(s,e,o)=>_w(s,e,{...(o||{}),enableHighAccuracy:true,maximumAge:0});")
        ctx.add_init_script(f"localStorage.setItem('waylix.settings.v1', {json.dumps(json.dumps(SETTINGS))});")
        ctx.route("**/photon.komoot.io/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(FIXTURE_PLACES)))
        ctx.route("**/routing.openstreetmap.de/**", lambda r: r.abort())
        ctx.route("**/tiles.openfreemap.org/**", lambda r: r.abort())
        page = ctx.new_page()
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))

        def shot(name, wait=0.8):
            time.sleep(wait)
            page.screenshot(path=str(OUT / f"{name}.png"))
            print("saved", name)

        page.goto(APP)
        page.wait_for_selector("text=Report a hazard", timeout=30000)
        # Emulated GPS only notifies watchPosition() on change; nudge it so the
        # app receives its first fix (see review: no getCurrentPosition seed).
        for dlat in (0.00001, 0.0):
            time.sleep(0.8)
            ctx.set_geolocation({"longitude": START[0], "latitude": START[1] + dlat, "accuracy": 6})
        shot("01-city-overview", 3)

        page.get_by_label("Center on me").click()
        shot("02-street-level", 2.5)

        page.locator("circle[data-hazard]").first.wait_for(timeout=10000)
        hz = page.locator("circle[data-hazard]")
        # Tap the hazard nearest the screen centre (the seeded verified pothole).
        best, bestd = None, 1e9
        for i in range(hz.count()):
            b = hz.nth(i).bounding_box()
            if not b:
                continue
            d = abs(b["x"] - 195) + abs(b["y"] - 300)
            if d < bestd:
                best, bestd = i, d
        hz.nth(best).click(force=True)
        shot("03-hazard-details")
        page.get_by_label("Close").last.click()

        page.get_by_text("Report a hazard").click()
        shot("04-report-sheet")
        page.locator("div[dir=auto]").filter(has_text="Missing manhole cover").first.click()
        shot("05-report-type-picked")
        page.get_by_placeholder("Optional note (lane, landmark…)").fill("Left lane, outside the bus stop")
        page.get_by_text("Send report").click()
        shot("06-report-sent", 1.5)

        page.get_by_text("🚶  Walk").click()
        page.get_by_placeholder("Where to?").fill("Juta")
        page.wait_for_selector("text=Juta Street", timeout=10000)
        shot("07-search-results")
        box = page.get_by_text("Juta Street").first.bounding_box()
        page.mouse.click(box["x"] + 10, box["y"] + 5)
        page.wait_for_selector("text=Start", timeout=15000)
        shot("08-route-preview", 1.5)

        page.get_by_text("Start", exact=True).click()
        shot("09-navigation", 1.5)
        for t in (0.15, 0.25, 0.32, 0.38):
            lon, lat = lerp(START, END, t)
            ctx.set_geolocation({"longitude": lon, "latitude": lat, "accuracy": 5})
            time.sleep(1.2)
        shot("10-hazard-alert", 0.3)

        page.get_by_text("End", exact=True).click()
        page.get_by_label("Menu").click()
        shot("11-settings")
        page.get_by_text("⬇  Offline maps").click()
        shot("12-offline-maps")

        browser.close()
    (OUT / "console.txt").write_text("\n".join(console))
    print(f"{len(console)} console errors/warnings captured")


if __name__ == "__main__":
    main()
