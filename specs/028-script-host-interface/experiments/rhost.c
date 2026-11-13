/* experiment E2: R host process. Rf_initEmbeddedR on the MAIN thread, run a
 * script FILE by path via source(), reply with one JSON line built in C
 * (no jsonlite). Protocol: stdin "path\n". SIGINT -> R interrupt. */
#define _GNU_SOURCE
#include <R.h>
#include <Rinternals.h>
#include <Rembedded.h>
#include <R_ext/Parse.h>
#include <R_ext/Rdynload.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#define R_INTERFACE_PTRS
#include <Rinterface.h>
extern int R_interrupts_pending;

static void on_sigint(int s) { (void)s; R_interrupts_pending = 1; }

static const char *BOOT =
".cz_where <- function(calls) {\n"
"  for (cl in rev(calls)) { sr <- attr(cl, 'srcref'); if (!is.null(sr)) { f <- attr(sr, 'srcfile'); return(paste0(f$filename, ':', sr[1])) } }\n"
"  NA_character_\n"
"}\n"
".cz_run <- function(path) {\n"
"  out <- character(); err <- character(); ok <- TRUE; emsg <- NA_character_; val <- NA_character_; loc <- NA_character_\n"
"  o <- textConnection('out', 'w', local = TRUE); e <- textConnection('err', 'w', local = TRUE)\n"
"  sink(o); sink(e, type = 'message')\n"
"  tryCatch(withCallingHandlers({\n"
"    r <- source(path, local = .GlobalEnv, echo = FALSE, keep.source = TRUE)\n"
"    val <- if (is.null(r$value)) NA_character_ else paste(deparse(r$value), collapse = ' ')\n"
"  }, error = function(c) loc <<- .cz_where(sys.calls())),\n"
"     interrupt = function(i) { ok <<- FALSE; emsg <<- 'interrupted' },\n"
"     error = function(c) { ok <<- FALSE; emsg <<- paste0('Error in ', paste(deparse(conditionCall(c))[1]), ' : ', conditionMessage(c), if (!is.na(loc)) paste0(' [', loc, ']') else '') })\n"
"  sink(type = 'message'); sink(); close(e); close(o)\n"
"  c(as.character(ok), val, emsg, paste(out, collapse = '\\n'), paste(err, collapse = '\\n'))\n"
"}\n";

static void json_str(FILE *f, SEXP s) {
  if (s == R_NilValue || STRING_ELT(s, 0) == NA_STRING) { fputs("null", f); return; }
  const char *p = CHAR(STRING_ELT(s, 0));
  fputc('"', f);
  for (; *p; p++) {
    unsigned char c = (unsigned char)*p;
    if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); }
    else if (c == '\n') fputs("\\n", f);
    else if (c == '\r') fputs("\\r", f);
    else if (c == '\t') fputs("\\t", f);
    else if (c < 0x20) fprintf(f, "\\u%04x", c);
    else fputc(c, f);
  }
  fputc('"', f);
}

int main(void) {
  prctl(PR_SET_PDEATHSIG, SIGKILL);
  { const char *mb = getenv("CZ_MEM_MB"); if (mb) { struct rlimit rl; rl.rlim_cur = rl.rlim_max = (rlim_t)atol(mb) << 20; setrlimit(RLIMIT_AS, &rl); } }
  char *argv[] = {(char *)"cz-rhost", (char *)"--vanilla", (char *)"--slave", (char *)"--no-save"};
  R_SignalHandlers = 0;                /* we own signals */
  int rc = Rf_initEmbeddedR(4, argv);  /* returns 1 on success */
  fprintf(stderr, "Rf_initEmbeddedR returned %d\n", rc);
  signal(SIGINT, on_sigint);
  ParseStatus st; int err = 0;
  SEXP code = PROTECT(Rf_mkString(BOOT));
  SEXP parsed = PROTECT(R_ParseVector(code, -1, &st, R_NilValue));
  for (int i = 0; i < Rf_length(parsed); i++) R_tryEvalSilent(VECTOR_ELT(parsed, i), R_GlobalEnv, &err);
  UNPROTECT(2);
  if (err) return 4;
  puts("READY"); fflush(stdout);
  char *line = NULL; size_t cap = 0;
  while (getline(&line, &cap, stdin) > 0) {
    line[strcspn(line, "\n")] = 0;
    { char *tab = strchr(line, '\t'); if (tab) *tab = 0; }
    SEXP call = PROTECT(Rf_lang2(Rf_install(".cz_run"), Rf_mkString(line)));
    int e2 = 0;
    SEXP res = PROTECT(R_tryEvalSilent(call, R_GlobalEnv, &e2));
    if (e2 || Rf_length(res) != 5) { puts("{\"ok\":false,\"error\":\"host: runner failed\"}"); }
    else {
      SEXP v[5]; for (int i = 0; i < 5; i++) v[i] = Rf_ScalarString(STRING_ELT(res, i));
      fputs("{\"ok\":", stdout); fputs(strcmp(CHAR(STRING_ELT(res, 0)), "TRUE") == 0 ? "true" : "false", stdout);
      fputs(",\"result\":", stdout); json_str(stdout, v[1]);
      fputs(",\"error\":", stdout); json_str(stdout, v[2]);
      fputs(",\"stdout\":", stdout); json_str(stdout, v[3]);
      fputs(",\"stderr\":", stdout); json_str(stdout, v[4]);
      puts("}");
    }
    UNPROTECT(2); fflush(stdout);
  }
  return 0;
}
