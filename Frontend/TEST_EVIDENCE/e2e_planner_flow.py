import asyncio, sys, json, sqlite3
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/dev-server/TEST_EVIDENCE/browser-mode")
OUT.mkdir(parents=True, exist_ok=True)
log = []
def note(step, ok, detail=""):
    log.append({"step": step, "ok": ok, "detail": detail}); print(("PASS " if ok else "FAIL ") + step, detail, flush=True)

async def pick(page, label, option):
    await page.get_by_role("combobox", name=label).click()
    await page.get_by_role("option", name=option, exact=True).click()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(viewport={"width": 1440, "height": 1100}, accept_downloads=True)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE + "/", wait_until="networkidle")
        await page.get_by_role("heading", name="Dashboard").wait_for(timeout=30000)
        note("opens straight into dashboard (no login)", page.url.endswith("/dashboard"), page.url)
        chip = await page.get_by_text("Data: this").first.inner_text()
        note("storage mode shown", True, chip)
        await page.screenshot(path=str(OUT / "01_dashboard_empty.png"))

        # provider
        await page.goto(BASE + "/providers"); await page.get_by_role("heading", name="AI Provider Manager").wait_for()
        await page.get_by_role("button", name="Add Test provider").click()
        await page.get_by_test_id("provider-card").first.wait_for()
        await page.get_by_role("button", name="Test connection").first.click()
        await page.get_by_text("Worked").first.wait_for(timeout=10000)
        note("test provider added and connection test passes", True)
        await page.screenshot(path=str(OUT / "02_provider_test.png"))

        # calendar + AI
        await page.goto(BASE + "/planner?new=true&ai=true"); await page.get_by_label("Name").wait_for()
        await page.get_by_label("Name").fill("Hospital calendar 2028")
        await page.get_by_label("Industry").fill("Medical & healthcare")
        await page.get_by_label("Country / region").fill("India")
        await page.get_by_label("Default posting time").fill("09:00")
        await page.get_by_role("button", name="Create calendar").click()
        await page.get_by_role("heading", name="Ask AI for events").wait_for()
        await page.get_by_label("What do you need?").fill("Create a complete medical awareness event calendar for India for 2028.")
        await page.get_by_role("tab", name="Year").click()
        await pick(page, "Year", "2028")
        await page.screenshot(path=str(OUT / "03_ai_request.png"))
        await page.get_by_role("button", name="Get suggestions").click()
        await page.get_by_text("AI proposal — not saved yet").wait_for(timeout=15000)
        rows = await page.get_by_test_id("proposal-row").count()
        note("AI proposal shown in preview, not saved", rows == 37, f"{rows} proposals")
        await page.get_by_role("button", name="item").filter(has_text="rejected").click() if False else None
        await page.get_by_text("rejected by the automatic checks").click()
        rej = await page.get_by_test_id("rejected-list").inner_text()
        note("validation rejected bad items with reasons", "outside the requested period" in rej and "Invalid date" in rej and "Duplicate" in rej, rej.replace("\n", " | "))
        approve = page.get_by_role("button", name="Approve & save 37")
        note("approval blocked until medical review ticked", await approve.is_disabled())
        await page.screenshot(path=str(OUT / "04_proposal_review.png"))
        # deselect one proposal
        await page.get_by_label("Include Medical & healthcare community Q&A").first.click()
        await page.get_by_label("I reviewed the medical events").click()
        await page.get_by_role("button", name="Approve & save 36").click()
        await page.get_by_role("alertdialog").get_by_role("button", name="Approve & save").click()
        await page.get_by_text("36 events approved and saved").wait_for()
        note("explicit approval saved selected proposals only", True, "36 of 37")
        await page.get_by_text("AI proposal — not saved yet").wait_for(state="detached", timeout=15000)
        await expect(page.get_by_test_id("calendar-range")).to_contain_text("January 2028", timeout=15000)

        # calendar
        rng = await page.get_by_test_id("calendar-range").inner_text()
        note("three months in one row", rng.count("|") == 2 and await page.locator("[data-month]").count() == 3, rng)
        boxes = [await page.locator(f"[data-month]").nth(i).bounding_box() for i in range(3)]
        note("months side by side (same row)", abs(boxes[0]["y"] - boxes[2]["y"]) < 2 and boxes[0]["x"] < boxes[1]["x"] < boxes[2]["x"])
        feb = page.locator("[data-month='2028-02'] [data-date]")
        n_feb = await feb.count()
        note("leap year: February 2028 has 29 days", n_feb == 29 and await page.locator("[data-date='2028-02-29']").count() == 1, f"{n_feb} days")
        blanks = await page.evaluate("""() => { const g = document.querySelectorAll("[data-month='2028-02'] .grid")[1]; let n=0; for (const c of g.children) { if (c.getAttribute('aria-hidden')) n++; else break; } return n; }""")
        note("weekday alignment: Feb 1 2028 is a Tuesday (1 blank Monday cell before it)", blanks == 1, f"{blanks} blank cell(s)")
        await page.screenshot(path=str(OUT / "05_three_month_calendar.png"))

        # global time
        await page.get_by_label("Default for the whole calendar").fill("08:15")
        await page.get_by_role("button", name="Apply to entire calendar").click()
        await page.get_by_role("alertdialog").get_by_role("button", name="Apply").click()
        await page.get_by_text("Default time is now 8:15 AM").wait_for()
        note("global default time applied", True)
        # multi-date override
        await page.get_by_label("Select dates").click()
        await page.locator("[data-date='2028-01-15']").click()
        await page.locator("[data-date='2028-02-15']").click()
        bar = await page.get_by_test_id("date-selection-bar").inner_text()
        await page.get_by_label("Time for selected dates").fill("18:45")
        await page.get_by_role("button", name="Apply to selected dates").click()
        await page.get_by_text("set to 6:45 PM").wait_for()
        note("multi-date selection + individual override", "2 dates selected" in bar, bar.split("\n")[0])
        await page.screenshot(path=str(OUT / "06_multi_date_override.png"))
        # global change again: overrides must win
        await page.get_by_role("button", name="Clear selected dates").click()
        await page.get_by_label("Default for the whole calendar").fill("10:30")
        await page.get_by_role("button", name="Apply to entire calendar").click()
        txt = await page.get_by_role("alertdialog").inner_text()
        await page.get_by_role("alertdialog").get_by_role("button", name="Apply").click()
        note("overrides keep priority over new global default", "keep their own time" in txt, txt.split("\n")[1] if "\n" in txt else txt)

        # list view
        await pick(page, "Show As", "List View")
        await page.get_by_test_id("event-tile").first.wait_for()
        tiles = await page.get_by_test_id("event-tile").count()
        first = await page.get_by_test_id("event-tile").first.inner_text()
        note("list view tiles with MM/DD/YYYY", tiles == 36 and first.startswith("01/01/2028"), first.split("\n")[0])
        t15 = await page.get_by_label("Time for Medical & healthcare mid-month tips").first.input_value()
        t01 = await page.get_by_label("Time for Medical & healthcare monthly kickoff").first.input_value()
        note("tile times: override 18:45 vs default 10:30", t15 == "18:45" and t01 == "10:30", f"15th={t15} 1st={t01}")
        await page.screenshot(path=str(OUT / "07_list_view.png"))
        await page.get_by_role("textbox", name="Search").fill("leap")
        n = await page.get_by_test_id("event-tile").count()
        note("search filter", n == 1, f"{n} tile")
        await page.get_by_role("textbox", name="Search").fill("")
        await pick(page, "Sort", "Date (latest)")
        last = (await page.get_by_test_id("event-tile").first.inner_text()).split("\n")[0]
        note("sort by date descending", last.startswith("12/15/2028"), last)
        await page.get_by_label("Select all shown").click()
        await page.get_by_role("button", name="Schedule", exact=True).click()
        await page.get_by_text("event(s) scheduled").wait_for()
        note("bulk schedule of approved events", True)
        # Edit one event -> approval removed
        await page.get_by_role("button", name="Edit Leap day special").click()
        await page.get_by_label("Short description").fill("Edited after approval")
        await page.get_by_role("button", name="Save changes").click()
        await page.get_by_text("needs review again").first.wait_for()
        note("editing an approved event sends it back to review", True)
        async with page.expect_download() as d:
            await page.get_by_role("button", name="Export").click()
            await page.get_by_role("menuitem", name="Shown events as CSV").click()
        dl = await d.value
        await dl.save_as(str(OUT / "export.csv"))
        lines = (OUT / "export.csv").read_text().splitlines()
        note("CSV export", len(lines) == 37, f"{len(lines)-1} rows, header: {lines[0][:60]}")
        await page.screenshot(path=str(OUT / "08_list_bulk.png"))

        # persistence after reload
        await page.reload(wait_until="networkidle")
        await page.get_by_test_id("calendar-range").wait_for()
        await pick(page, "Show As", "List View")
        n = await page.get_by_test_id("event-tile").count()
        note("events persist after restart (reload)", n == 36, f"{n} tiles")

        # dashboard real numbers
        await page.goto(BASE + "/dashboard"); await page.get_by_test_id("stat-Events").wait_for()
        await page.wait_for_timeout(500)
        stats = {k: await page.get_by_test_id(f"stat-{k}").inner_text() for k in ["Events", "Needs review", "Approved", "Scheduled"]}
        note("dashboard counts from database", stats["Events"] == "36", json.dumps(stats))
        await page.screenshot(path=str(OUT / "09_dashboard_filled.png"))

        # backup -> verify with sqlite3
        await page.goto(BASE + "/database"); await page.get_by_role("button", name="Run integrity check").click()
        integ = await page.get_by_test_id("integrity-result").inner_text()
        note("integrity check", integ == "Result: ok", integ)
        async with page.expect_download() as d:
            await page.get_by_role("button", name="Download backup").click()
        dl = await d.value
        bk = OUT / "backup.sqlite"; await dl.save_as(str(bk))
        con = sqlite3.connect(bk)
        q = lambda s: con.execute(s).fetchall()
        sql = {
            "events": q("select count(*) from events")[0][0],
            "approved": q("select count(*) from events where approval_status='approved'")[0][0],
            "pending": q("select name from events where approval_status='pending_review'"),
            "scheduled": q("select count(*) from events where publish_status='scheduled'")[0][0],
            "unapproved_scheduled": q("select count(*) from events where publish_status='scheduled' and approval_status!='approved'")[0][0],
            "default_time": q("select default_time from calendars")[0][0],
            "overrides": q("select start_date, name, time_override from events where time_override is not null order by start_date"),
            "feb29": q("select name from events where start_date='2028-02-29'"),
            "runs": q("select status, json_array_length(proposals), json_array_length(rejected) from event_generation_runs"),
        }
        (OUT / "sqlite_verification.json").write_text(json.dumps(sql, indent=1))
        note("SQLite verification", sql["events"] == 36 and sql["unapproved_scheduled"] == 0 and sql["default_time"] == "10:30" and len(sql["overrides"]) == 3, json.dumps(sql)[:400])
        await page.screenshot(path=str(OUT / "10_database.png"))
        note("no page errors", not errors, "; ".join(errors)[:300])
        (OUT / "results.json").write_text(json.dumps(log, indent=1))
        await b.close()
    print("SUMMARY", sum(1 for x in log if x["ok"]), "/", len(log))

asyncio.run(main())
