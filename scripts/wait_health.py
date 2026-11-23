import time, urllib.request
for i in range(40):
    try:
        b = urllib.request.urlopen("http://127.0.0.1:8765/api/health", timeout=2).read().decode()
        print(b[:500])
        raise SystemExit(0)
    except Exception as e:
        time.sleep(2)
        print("wait", i, type(e).__name__)
print("TIMEOUT")
raise SystemExit(1)
