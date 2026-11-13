# Contract: `cz_script.h` — language-neutral C ABI

Versioned ABI implemented by each language module (`libcz_python.so`,
`libcz_r.so`), loaded by `cz-host` via `dlopen`. All types are C; the ABI is
frozen per major version — appends require a version bump (FR-007/009).

```c
/* cz_script.h — ABI version 1 */
#define CZ_ABI_VERSION 1

typedef struct cz_ctx cz_ctx;          /* opaque session handle */
typedef struct cz_result cz_result;    /* opaque result handle */

typedef struct {
  const char *language;        /* "python" | "r" (host matches to module) */
  const char *interpreter;     /* resolved executable path (venv hint, E4) */
  const char *lib_path;        /* shared lib (libpython/LIBDIR+INSTSONAME probe) */
} cz_config;

typedef struct {
  const char *path;            /* absolute script path — module reads it */
  const char *const *argv; int argc;         /* named args, "k=v" pairs    */
  const char *input;           /* raw text arg (paramless scripts), may be NULL */
  const char *cwd;             /* per-run working dir */
  const char *expected_sha256; /* NULL → no fingerprint check */
  long  mem_bytes;             /* 0 = unlimited */
  long  output_bytes;          /* 0 = default cap */
} cz_request;

typedef enum {
  CZ_OK, CZ_ERROR, CZ_INTERRUPTED, CZ_TIMEOUT,
  CZ_SOURCE_MISSING, CZ_CONTENT_CHANGED, CZ_HOST_FAULT
} cz_outcome;

/* lifecycle */
int      cz_abi_version(void);                          /* == CZ_ABI_VERSION */
cz_ctx  *cz_open(const cz_config *);                    /* NULL on init fail  */
void     cz_close(cz_ctx *);

/* run — synchronous on the calling thread; host serializes calls.
   *out must be freed with cz_result_free(). */
int      cz_run_file(cz_ctx *, const cz_request *, cz_result **out);

/* cooperative interrupt of the in-flight run on this ctx
   (called from cz-host's SIGINT handler thread; safe to call
   when no run is in flight). */
void     cz_interrupt(cz_ctx *);

/* result accessors (borrowed, valid until cz_result_free) */
cz_outcome cz_result_outcome(const cz_result *);
const char *cz_result_value(const cz_result *);       /* may be NULL */
const char *cz_result_error_type(const cz_result *);
const char *cz_result_error_message(const cz_result *);
const char *cz_result_error_traceback(const cz_result *);
const char *cz_result_error_file(const cz_result *);  /* may be NULL */
long        cz_result_error_line(const cz_result *);  /* -1 when n/a  */
const char *cz_result_stdout(const cz_result *);
const char *cz_result_stderr(const cz_result *);
const char *cz_result_content_sha256(const cz_result *); /* hex, may be NULL */
long        cz_result_duration_ms(const cz_result *);
void        cz_result_free(cz_result *);
```

## Module obligations

- **Reads the file itself** at `cz_run_file` — the bytes hashed for
  `content_sha256` are the bytes compiled/`source()`d (FR-001/004).
- **Fingerprint check before execution**: `expected_sha256` present and
  different ⇒ `CZ_CONTENT_CHANGED`, no code runs (FR-005, SC-006).
- Missing/unreadable `path` ⇒ `CZ_SOURCE_MISSING` (FR-006).
- Errors carry file+line where the language provides them (Python traceback;
  R via `srcref`, FR-003).
- Session state persists across `cz_run_file` calls on the same ctx (FR-017).
- `cz_interrupt` must make a running script stop promptly (Python: async
  exception/`PyErr_SetInterrupt` analogue; R: `R_interrupts_pending`) — code
  blocked in a native extension may ignore it; escalation is the host's job.
- No cross-language dependencies: `libcz_python` must not require R
  dev files or libs and vice versa (US2).
- Python module MUST NOT require `Python.h` to build (header-free `dlopen`
  + `PyInitConfig`, FR-008); R module may link `libR` (needs R headers) but
  MUST NOT require `jsonlite` (FR-016).
