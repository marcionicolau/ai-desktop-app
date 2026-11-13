/* feature 023 mechanism (a): embedded script-runtime shim (research D3).
 *
 * Python (cz_py_*): bun:ffi dlopen() is RTLD_LOCAL, so extension
 * modules can't resolve interpreter symbols. The shim dlopens
 * libpython with RTLD_GLOBAL itself and dlsym's the 3 needed symbols —
 * no -lpython link, no headers:
 *   int cz_py_init(const char *libpath) — global-scope load + Py_Initialize
 *   int cz_py_exec(const char *code)    — PyRun_SimpleString wrapper
 *
 * R (czr_*): SEXP plumbing isn't tractable through raw FFI either:
 *   int czr_init(void)                  — Rf_initEmbeddedR + bootstrap
 *   int czr_eval(b64, cwd, out)         — eval request → JSON file
 * .GlobalEnv is the persistent session. Known upstream limitation:
 * embedded R cannot be re-initialized in-process — reset requires a
 * worker restart (the benchmark measures this; research D3). */
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <dlfcn.h>

static void *pyh = NULL;
static void (*py_init)(void) = NULL;
static int (*py_isinit)(void) = NULL;
static int (*py_run)(const char *) = NULL;

int cz_py_init(const char *libpath) {
  if (pyh) return 0;
  pyh = dlopen(libpath, RTLD_NOW | RTLD_GLOBAL);
  if (!pyh) return 2;
  py_init = (void (*)(void))dlsym(pyh, "Py_Initialize");
  py_isinit = (int (*)(void))dlsym(pyh, "Py_IsInitialized");
  py_run = (int (*)(const char *))dlsym(pyh, "PyRun_SimpleString");
  if (!py_init || !py_isinit || !py_run) return 3;
  if (!py_isinit()) py_init();
  return 0;
}

int cz_py_exec(const char *code) {
  if (!py_run) return 2;
  return py_run(code) == 0 ? 0 : 1;
}

#include <R.h>
#include <Rinternals.h>
#include <Rembedded.h>
#include <R_ext/Parse.h>
#define CSTACK_DEFNS /* exposes R_CStackLimit/R_CStackStart */
#define R_INTERFACE_PTRS /* exposes ptr_R_WriteConsoleEx et al. */
#include <Rinterface.h>

/* console output is captured inside R via sink(textConnection) —
 * WriteConsoleEx override would interleave with the shim's own diag */
static char czr_err[2048];
static int czr_ready = 0;

static void czr_writeconsole(const char *buf, int len, int otype) {
  (void)otype;
  if (len <= 0) return;
  size_t cur = strlen(czr_err);
  size_t room = sizeof(czr_err) - cur - 1;
  size_t n = (size_t)len < room ? (size_t)len : room;
  memcpy(czr_err + cur, buf, n);
  czr_err[cur + n] = 0;
}

/* bootstrap: persistent runner function in .GlobalEnv. args/input
 * arrive base64'd (injection-proof); jsonlite does the JSON work. */
static const char *CZR_BOOTSTRAP =
    "if (!requireNamespace('jsonlite', quietly=TRUE)) "
    "  stop('jsonlite is required') ;"
    ".cz_run <- function(code_b64, cwd, out_path) {"
    "  req <- jsonlite::fromJSON(rawToChar(jsonlite::base64_dec(code_b64)));"
    "  out <- textConnection('.cz_out', 'w', local=TRUE);"
    "  err <- textConnection('.cz_err', 'w', local=TRUE);"
    "  sink(out); sink(err, type='message');"
    "  res <- NULL; emsg <- NULL;"
    "  tryCatch({ setwd(cwd);"
    "    ARGS <<- req$args; INPUT <<- req$input;"
    "    res <- eval(parse(text=req$code), envir=.GlobalEnv);"
    "  }, error=function(e) emsg <<- conditionMessage(e));"
    "  sink(type='message'); sink(); close(err); close(out);"
    "  files <- character(0);"
    "  if (dir.exists(cwd)) files <- sort(list.files(cwd, all.files=FALSE));"
    "  resp <- list(id=req$id, ok=is.null(emsg),"
    "    result=if (is.null(res)) NULL else deparse(res)[1],"
    "    error=emsg, stdout=paste(.cz_out, collapse='\\n'),"
    "    stderr=paste(.cz_err, collapse='\\n'), files=files);"
    "  writeLines(jsonlite::toJSON(resp, auto_unbox=TRUE, null='null'),"
    "    out_path); invisible(NULL)"
    "}";

static SEXP czr_parse_eval(const char *expr, int *err) {
  ParseStatus st;
  SEXP s = PROTECT(Rf_mkString(expr));
  SEXP parsed = PROTECT(R_ParseVector(s, -1, &st, R_NilValue));
  if (st != PARSE_OK) {
    *err = 1;
    UNPROTECT(2);
    return R_NilValue;
  }
  SEXP res = R_tryEval(VECTOR_ELT(parsed, 0), R_GlobalEnv, err);
  UNPROTECT(2);
  return res;
}

/* escape a C string for embedding in an R "..." literal */
static char *czr_escape(const char *s) {
  size_t n = strlen(s), cap = n * 2 + 3, i, j = 0;
  char *r = (char *)malloc(cap);
  r[j++] = '"';
  for (i = 0; i < n; i++) {
    if (s[i] == '"' || s[i] == '\\') r[j++] = '\\';
    r[j++] = s[i];
  }
  r[j++] = '"';
  r[j] = 0;
  return r;
}

int czr_init(void) {
  if (czr_ready) return 0; /* cannot re-init — documented limitation */
  char *argv[] = {(char *)"causerie", (char *)"--vanilla", (char *)"--slave"};
  czr_err[0] = 0;
  R_SignalHandlers = 0; /* keep Bun's signals — R must not steal them */
  setenv("R_ENABLE_JIT", "0", 1); /* JIT init stack-checks fatally in a worker */
  /* R_CStackLimit == -1 makes init recompute the limit against the
   * host main-thread stack — bogus in a worker. Anchor Start here and
   * give a limit that can't be exceeded by honest evals. */
  R_CStackStart = (uintptr_t)&argv;
  R_CStackLimit = (uintptr_t)1 << 40;
  ptr_R_WriteConsoleEx = czr_writeconsole;
  ptr_R_WriteConsole = NULL;
  if (Rf_initEmbeddedR(3, argv) != 0) return 2;
  int err = 0;
  czr_parse_eval(CZR_BOOTSTRAP, &err);
  if (err) return 3;
  czr_ready = 1;
  return 0;
}

int czr_eval(const char *req_b64, const char *cwd, const char *out_path) {
  if (!czr_ready) return 2;
  czr_err[0] = 0;
  char *a = czr_escape(req_b64);
  char *b = czr_escape(cwd);
  char *c = czr_escape(out_path);
  size_t need = strlen(a) + strlen(b) + strlen(c) + 32;
  char *expr = (char *)malloc(need);
  snprintf(expr, need, ".cz_run(%s,%s,%s)", a, b, c);
  free(a);
  free(b);
  free(c);
  int err = 0;
  czr_parse_eval(expr, &err);
  free(expr);
  if (err && czr_err[0]) {
    /* runner itself failed — write a minimal error response */
    FILE *f = fopen(out_path, "w");
    if (f) {
      fprintf(f,
              "{\"id\":0,\"ok\":false,\"result\":null,\"error\":\"%s\","
              "\"stdout\":\"\",\"stderr\":\"\",\"files\":[]}",
              czr_err);
      fclose(f);
    }
  }
  return err ? 1 : 0;
}
