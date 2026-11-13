/* experiment E1: header-free Python host process. dlopen(libpython),
 * PyInitConfig (3.14 opaque-handle config API), run a script FILE by path,
 * reply with one JSON line. Protocol: stdin "path\targs_json\n". */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <signal.h>

typedef void PyObj;
static void *(*PyInitConfig_Create)(void);
static int (*PyInitConfig_SetInt)(void *, const char *, int64_t);
static int (*PyInitConfig_SetStr)(void *, const char *, const char *);
static int (*PyInitConfig_GetError)(void *, const char **);
static void (*PyInitConfig_Free)(void *);
static int (*Py_InitializeFromInitConfig)(void *);
static int (*PyRun_SimpleStringFlags)(const char *, void *);
static PyObj *(*PyImport_AddModule)(const char *);
static PyObj *(*PyModule_GetDict)(PyObj *);
static PyObj *(*PyDict_GetItemString)(PyObj *, const char *);
static PyObj *(*PyObject_CallFunction)(PyObj *, const char *, ...);
static const char *(*PyUnicode_AsUTF8)(PyObj *);
static void (*Py_DecRef)(PyObj *);
static PyObj *(*PyErr_Occurred)(void);
static void (*PyErr_Print)(void);

#define LOAD(n) do { *(void **)&n = dlsym(H, #n); if (!n) { fprintf(stderr, "missing %s\n", #n); return 3; } } while (0)

static const char *BOOT =
"import ast, contextlib, io, json, os, sys, traceback\n"
"_ns = {'__name__': '__main__'}\n"
"def _cz_run(path, args_json):\n"
"    args = json.loads(args_json or '{}')\n"
"    out, err = io.StringIO(), io.StringIO()\n"
"    ok, result, error = True, None, None\n"
"    _ns['ARGS'] = args\n"
"    for k, v in args.items():\n"
"        if isinstance(k, str) and k.isidentifier(): _ns[k] = v\n"
"    try:\n"
"        with open(path, 'rb') as f: src = f.read()\n"
"        d = os.path.dirname(os.path.abspath(path))\n"
"        if d not in sys.path: sys.path.insert(0, d)\n"
"        _ns['__file__'] = os.path.abspath(path)\n"
"        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):\n"
"            tree = ast.parse(src, filename=path)\n"
"            if tree.body and isinstance(tree.body[-1], ast.Expr):\n"
"                last = tree.body.pop()\n"
"                exec(compile(tree, path, 'exec'), _ns)\n"
"                result = eval(compile(ast.Expression(last.value), path, 'eval'), _ns)\n"
"            else:\n"
"                exec(compile(tree, path, 'exec'), _ns)\n"
"    except KeyboardInterrupt:\n"
"        ok, error = False, 'interrupted'\n"
"    except SystemExit as e:\n"
"        ok, error = False, 'SystemExit: %s' % (e.code,)\n"
"    except BaseException:\n"
"        ok, error = False, traceback.format_exc(limit=8)\n"
"    return json.dumps({'ok': ok, 'result': None if result is None else repr(result), 'error': error, 'stdout': out.getvalue(), 'stderr': err.getvalue()})\n";

int main(int argc, char **argv) {
  prctl(PR_SET_PDEATHSIG, SIGKILL); /* die with the parent: no orphans */
  { const char *mb = getenv("CZ_MEM_MB"); if (mb) { struct rlimit r; r.rlim_cur = r.rlim_max = (rlim_t)atol(mb) << 20; setrlimit(RLIMIT_AS, &r); } }
  const char *lib = argc > 1 ? argv[1] : "/usr/lib64/libpython3.14.so.1.0";
  void *H = dlopen(lib, RTLD_NOW | RTLD_GLOBAL);
  if (!H) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 2; }
  LOAD(PyInitConfig_Create); LOAD(PyInitConfig_SetInt); LOAD(PyInitConfig_SetStr);
  LOAD(PyInitConfig_GetError); LOAD(PyInitConfig_Free); LOAD(Py_InitializeFromInitConfig);
  LOAD(PyRun_SimpleStringFlags); LOAD(PyImport_AddModule); LOAD(PyModule_GetDict);
  LOAD(PyDict_GetItemString); LOAD(PyObject_CallFunction); LOAD(PyUnicode_AsUTF8);
  LOAD(Py_DecRef); LOAD(PyErr_Occurred); LOAD(PyErr_Print);
  void *cfg = PyInitConfig_Create();
  { const char *exe = getenv("CZ_PYEXE"); if (exe) PyInitConfig_SetStr(cfg, "executable", exe); }
  PyInitConfig_SetInt(cfg, "isolated", 1);          /* ignore env + user site */
  PyInitConfig_SetInt(cfg, "site_import", 1);
  PyInitConfig_SetInt(cfg, "install_signal_handlers", 1); /* SIGINT -> KeyboardInterrupt */
  if (Py_InitializeFromInitConfig(cfg) < 0) {
    const char *m = NULL; PyInitConfig_GetError(cfg, &m);
    fprintf(stderr, "init failed: %s\n", m ? m : "?"); return 4;
  }
  PyInitConfig_Free(cfg);
  if (PyRun_SimpleStringFlags(BOOT, NULL) != 0) return 5;
  PyObj *fn = PyDict_GetItemString(PyModule_GetDict(PyImport_AddModule("__main__")), "_cz_run");
  puts("READY"); fflush(stdout);
  char *line = NULL; size_t cap = 0;
  while (getline(&line, &cap, stdin) > 0) {
    line[strcspn(line, "\n")] = 0;
    char *tab = strchr(line, '\t');
    const char *args = "{}";
    if (tab) { *tab = 0; args = tab + 1; }
    PyObj *res = PyObject_CallFunction(fn, "ss", line, args);
    if (!res) { PyErr_Print(); puts("{\"ok\":false,\"error\":\"host: call failed\"}"); }
    else { puts(PyUnicode_AsUTF8(res)); Py_DecRef(res); }
    fflush(stdout);
  }
  return 0;
}
