import json, os, signal, statistics, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
S = os.path.join(HERE, "scripts")

def spawn():
    t0 = time.perf_counter()
    p = subprocess.Popen([os.path.join(HERE, "pyhost")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    ready = p.stdout.readline().strip()
    return p, (time.perf_counter() - t0) * 1000, ready

def call(p, script, args="{}"):
    t0 = time.perf_counter()
    p.stdin.write(f"{os.path.join(S, script)}\t{args}\n"); p.stdin.flush()
    line = p.stdout.readline()
    return (json.loads(line) if line else None), (time.perf_counter() - t0) * 1000

p, startup, ready = spawn()
print(f"startup: {startup:.0f} ms ({ready})")
r, ms = call(p, "info.py"); print("info:", r["stdout"].strip(), "|", f"{ms:.2f} ms cold")
r, ms = call(p, "ok.py"); print("ok:", r["ok"], r["result"], repr(r["stdout"]))
lat = [call(p, "ok.py")[1] for _ in range(300)]
print(f"warm: p50 {statistics.median(lat):.3f} ms  p95 {sorted(lat)[int(len(lat)*.95)]:.3f} ms")
r, _ = call(p, "err.py"); print("error has real filename + line:", "err.py" in r["error"] and "line 2" in r["error"]); print(r["error"].strip().splitlines()[-4:])
c1, _ = call(p, "state.py"); c2, _ = call(p, "state.py"); print("state persists:", c1["result"], c2["result"])
# interrupt: SIGINT during an infinite loop
p.stdin.write(f"{os.path.join(S,'loop.py')}\t{{}}\n"); p.stdin.flush()
time.sleep(0.3); t0 = time.perf_counter(); p.send_signal(signal.SIGINT)
line = p.stdout.readline(); dt = (time.perf_counter() - t0) * 1000
r = json.loads(line); print(f"interrupt: ok={r['ok']} error={r['error']!r} after {dt:.1f} ms")
r, _ = call(p, "ok.py"); print("session usable after interrupt:", r["ok"])
# crash containment: segfault in the script kills the HOST PROCESS only
p.stdin.write(f"{os.path.join(S,'crash.py')}\t{{}}\n"); p.stdin.flush()
line = p.stdout.readline(); rc = p.wait(timeout=5)
print(f"crash: reply={line!r} host exit={rc} (negative = signal {-rc}); this driver survived")
p2, startup2, _ = spawn(); r, _ = call(p2, "ok.py"); print(f"respawn: {startup2:.0f} ms, usable={r['ok']}")
p2.stdin.close(); p2.wait()
