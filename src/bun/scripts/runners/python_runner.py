# Causerie feature 023 — persistent Python session runner.
# Wire: NDJSON on stdin/stdout (one request/response per line).
# Request : {"id":n,"code":str,"args":{},"input":str|null,"cwd":str}
# Reply   : {"id":n,"ok":bool,"result":str|null,"error":str|null,
#            "stdout":str,"stderr":str,"files":[str]}
# The module-level namespace `_ns` IS the session — every exec() runs in
# it, so variables/imports/data survive across calls (research D2).
import ast
import contextlib
import io
import json
import os
import sys
import traceback

_ns = {"__name__": "__causerie_session__"}

# args become real variables: ARGS dict + one binding per key.
# input (raw text for paramless scripts) binds INPUT.


def _run(req):
    code = req["code"]
    args = req.get("args") or {}
    _ns["ARGS"] = args
    _ns["INPUT"] = req.get("input")
    for k, v in args.items():
        if isinstance(k, str) and k.isidentifier():
            _ns[k] = v
    cwd = req.get("cwd")
    if cwd:
        os.makedirs(cwd, exist_ok=True)
        os.chdir(cwd)
    before = set(os.listdir(cwd)) if cwd else set()
    out, err = io.StringIO(), io.StringIO()
    ok, result, error = True, None, None
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            # notebook semantics: a trailing bare expression is eval'd
            # and its value becomes `result`; earlier statements exec.
            tree = ast.parse(code)
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = tree.body.pop()
                exec(compile(tree, "<script>", "exec"), _ns)
                result = eval(
                    compile(ast.Expression(last.value), "<script>", "eval"),
                    _ns,
                )
            else:
                exec(compile(tree, "<script>", "exec"), _ns)
                result = _ns.get("_result")
    except SystemExit as e:  # script asked to exit — surface as error
        ok, error = False, f"SystemExit: {e.code}"
    except BaseException:
        ok, error = False, traceback.format_exc(limit=8)
    _ns.pop("_result", None)
    files = sorted(set(os.listdir(cwd)) - before) if cwd else []
    return {
        "id": req["id"],
        "ok": ok,
        "result": None if result is None else repr(result),
        "error": error,
        "stdout": out.getvalue(),
        "stderr": err.getvalue(),
        "files": files,
    }


def main():
    w = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = _run(req)
        except BaseException:
            resp = {
                "id": -1,
                "ok": False,
                "result": None,
                "error": "runner: " + traceback.format_exc(limit=4),
                "stdout": "",
                "stderr": "",
                "files": [],
            }
        w.write(json.dumps(resp) + "\n")
        w.flush()


if __name__ == "__main__":
    main()
