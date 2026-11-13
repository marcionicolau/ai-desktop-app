// feature 023 mechanism (a): embedded interpreter in a Bun Worker
// (research D3). FFI calls are synchronous — a Worker keeps the
// engine's event loop free, mirroring why llama generation is
// per-token. Python: pure dlopen of libpython. R: the vendored
// script_shim (SEXP manipulation isn't tractable via raw FFI).
import { dlopen, FFIType, ptr } from "bun:ffi";

declare var self: Worker & { onmessage: (e: MessageEvent) => void };

interface CallReq {
  id: number;
  code: string;
  args: Record<string, unknown>;
  input?: string | null;
  cwd: string;
}

interface CallResp {
  id: number;
  ok: boolean;
  result: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
  files: string[];
}

// Python-side bootstrap: persistent namespace _ns IS the session.
// Responses go to a per-call file — returning strings through
// PyRun_SimpleString isn't possible, and a file keeps the FFI
// surface to 3 symbols (prototype simplicity is the point).
const PY_BOOTSTRAP = `
import ast as _ast, base64 as _b64, contextlib as _cl, io as _io, json as _js, os as _os, traceback as _tb
_ns = {"__name__": "__main__"}
def _cz_run(req_b64, out_path):
    req = _js.loads(_b64.b64decode(req_b64).decode())
    out, err, res, emsg = _io.StringIO(), _io.StringIO(), None, None
    _ns["ARGS"] = req.get("args") or {}
    _ns["INPUT"] = req.get("input")
    for _k, _v in _ns["ARGS"].items():
        if isinstance(_k, str) and _k.isidentifier():
            _ns[_k] = _v
    try:
        _os.chdir(req["cwd"])
        with _cl.redirect_stdout(out), _cl.redirect_stderr(err):
            tree = _ast.parse(req["code"])
            if tree.body and isinstance(tree.body[-1], _ast.Expr):
                last = tree.body.pop()
                exec(compile(tree, "<script>", "exec"), _ns)
                res = eval(compile(_ast.Expression(last.value), "<script>", "eval"), _ns)
            else:
                exec(compile(tree, "<script>", "exec"), _ns)
                res = _ns.get("_result")
    except SystemExit as e:
        emsg = "SystemExit: %s" % (e.code,)
    except BaseException:
        emsg = _tb.format_exc()
    files = sorted(_os.listdir(req["cwd"])) if _os.path.isdir(req["cwd"]) else []
    resp = {"id": req["id"], "ok": emsg is None,
            "result": repr(res) if res is not None else None,
            "error": emsg, "stdout": out.getvalue(),
            "stderr": err.getvalue(), "files": files}
    with open(out_path, "w") as f:
        f.write(_js.dumps(resp))
`;

// config arrives in the init message — module-scope globals can't be
// injected before the worker boots. shim = script_shim lib; rtlib =
// libpython path (python only; R is linked into the shim).
let cfg: {
  rt: "python" | "r";
  shim: string;
  rtlib: string;
  resp: string;
} | null = null;

// one dlopen surface for both runtimes — the shim exports all four
const shimLib = () =>
  dlopen(cfg!.shim, {
    cz_py_init: { args: [FFIType.cstring], returns: FFIType.int },
    cz_py_exec: { args: [FFIType.cstring], returns: FFIType.int },
    czr_init: { args: [], returns: FFIType.int },
    czr_eval: {
      args: [FFIType.cstring, FFIType.cstring, FFIType.cstring],
      returns: FFIType.int,
    },
  });

let lib: ReturnType<typeof shimLib> | null = null;

function cstr(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(s + "\0", "utf8"));
}

function initPython(): void {
  lib = shimLib();
  const s = lib.symbols;
  const rc = s.cz_py_init(ptr(cstr(cfg!.rtlib)));
  if (rc !== 0) throw new Error(`cz_py_init failed (${rc})`);
  if (s.cz_py_exec(ptr(cstr(PY_BOOTSTRAP))) !== 0) {
    throw new Error("python bootstrap failed");
  }
}

function initR(): void {
  lib = shimLib();
  if (lib.symbols.czr_init() !== 0) throw new Error("R init failed");
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      cfg = { rt: msg.rt, shim: msg.shim, rtlib: msg.rtlib, resp: msg.resp };
      if (cfg.rt === "python") initPython();
      else initR();
      postMessage({ type: "init", ok: true });
    } catch (err) {
      postMessage({ type: "init", ok: false, error: String(err) });
    }
    return;
  }
  const req = msg as CallReq;
  const outPath = `${cfg!.resp}/embedded-${cfg!.rt}-${req.id}.json`;
  try {
    if (cfg!.rt === "python") {
      if (!lib) throw new Error("python not initialized");
      const b64 = Buffer.from(JSON.stringify(req)).toString("base64");
      lib.symbols.cz_py_exec(
        ptr(cstr(`_cz_run('${b64}', '${outPath.replace(/'/g, "")}')`)),
      );
    } else {
      if (!lib) throw new Error("R not initialized");
      const q = cstr(Buffer.from(JSON.stringify(req)).toString("base64"));
      const c = cstr(req.cwd);
      const o = cstr(outPath);
      if (lib.symbols.czr_eval(ptr(q), ptr(c), ptr(o)) !== 0) {
        throw new Error("R evaluation failed");
      }
    }
    const text = await Bun.file(outPath).text();
    postMessage({ type: "call", resp: JSON.parse(text) as CallResp });
  } catch (err) {
    postMessage({
      type: "call",
      resp: {
        id: req.id,
        ok: false,
        result: null,
        error: String(err),
        stdout: "",
        stderr: "",
        files: [],
      } satisfies CallResp,
    });
  }
};
