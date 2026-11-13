const HERE = import.meta.dir;
async function bench(host: string, script: string, label: string) {
  const t0 = performance.now();
  const p = Bun.spawn([`${HERE}/${host}`], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const reader = p.stdout.getReader();
  let buf = "";
  const readLine = async (): Promise<string> => {
    for (;;) {
      const i = buf.indexOf("\n");
      if (i >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); return l; }
      const { value, done } = await reader.read();
      if (done) return "";
      buf += new TextDecoder().decode(value);
    }
  };
  await readLine(); // READY
  const startup = performance.now() - t0;
  const call = async () => {
    const s = performance.now();
    p.stdin.write(`${HERE}/scripts/${script}\t{}\n`); await p.stdin.flush();
    const r = JSON.parse(await readLine());
    return [performance.now() - s, r] as const;
  };
  const [cold, r0] = await call();
  const lat: number[] = [];
  for (let i = 0; i < 300; i++) lat.push((await call())[0]);
  lat.sort((a, b) => a - b);
  console.log(`${label}: startup ${startup.toFixed(0)} ms | first call ${cold.toFixed(2)} ms | warm p50 ${lat[150]!.toFixed(3)} ms p95 ${lat[285]!.toFixed(3)} ms | ok=${r0.ok}`);
  p.kill(); await p.exited;
}
await bench("pyhost", "ok.py", "python host via Bun.spawn");
await bench("rhost", "ok.R", "R host      via Bun.spawn");
