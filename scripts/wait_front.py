import time, urllib.request
for i in range(45):
    try:
        r = urllib.request.urlopen("http://127.0.0.1:8080/", timeout=2)
        print("front", r.status)
        raise SystemExit(0)
    except Exception as e:
        time.sleep(2)
        print("wait", i, type(e).__name__)
print("TIMEOUT")
raise SystemExit(1)
