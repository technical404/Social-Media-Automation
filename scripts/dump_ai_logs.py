import sqlite3
p = r"C:\Users\rishu\Desktop\Social media automation\Frontend\data\socialai.sqlite"
c = sqlite3.connect(p)
c.row_factory = sqlite3.Row
print("providers:")
for r in c.execute("SELECT id,name,model_id,is_default,last_test_ok,last_test_message FROM ai_providers"):
    print(dict(r))
print("ai logs:")
for r in c.execute("SELECT provider_name,task,ok,latency_ms,error,created_at FROM ai_request_logs ORDER BY created_at DESC LIMIT 8"):
    print(dict(r))
print("runs", list(c.execute("SELECT id,status,provider_name,length(proposals) FROM event_generation_runs")))
print("events", c.execute("SELECT COUNT(*) FROM events").fetchone()[0])
