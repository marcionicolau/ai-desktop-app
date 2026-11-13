# Causerie feature 023 — persistent R session runner.
# Wire: NDJSON on stdin/stdout (same as python_runner.py).
# Requires jsonlite — if absent the runner exits with a clear stderr
# hint that surfaces as runtime-unavailable.
# The persistent environment `.ns` IS the session — every eval() runs
# in it, so bindings survive across calls (research D2).

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  cat("causerie: jsonlite is required for R script sessions\n", file = stderr())
  cat("install it with: install.packages(\"jsonlite\")\n", file = stderr())
  quit(save = "no", status = 3)
}

.ns <- new.env(parent = globalenv())

.capture <- function(req) {
  args <- if (is.null(req$args)) list() else req$args
  assign("ARGS", args, envir = .ns)
  assign("INPUT", if (is.null(req$input)) NULL else req$input, envir = .ns)
  for (k in names(args)) {
    if (nzchar(k) && make.names(k) == k) assign(k, args[[k]], envir = .ns)
  }
  cwd <- req$cwd
  if (!is.null(cwd) && nzchar(cwd)) {
    dir.create(cwd, showWarnings = FALSE, recursive = TRUE)
    setwd(cwd)
    before <- list.files(cwd, all.files = TRUE, no.. = TRUE)
  } else {
    before <- character()
  }
  out <- ""
  ok <- TRUE
  error <- NULL
  result <- NULL
  con <- textConnection("out", open = "w", local = TRUE)
  sink(con, type = "output")
  sink(con, type = "message")
  tryCatch(
    {
      result <- eval(parse(text = req$code), envir = .ns)
    },
    error = function(e) {
      ok <<- FALSE
      error <<- conditionMessage(e)
    }
  )
  sink(type = "message")
  sink(type = "output")
  close(con)
  files <- character()
  if (!is.null(cwd) && nzchar(cwd)) {
    now <- list.files(cwd, all.files = TRUE, no.. = TRUE)
    files <- sort(setdiff(now, before))
  }
  list(
    id = req$id,
    ok = ok,
    result = if (is.null(result)) NULL else paste(format(result), collapse = "\n"),
    error = error,
    stdout = paste(out, collapse = "\n"),
    stderr = "",
    files = as.list(files)
  )
}

conn <- file("stdin", open = "r")
repeat {
  line <- readLines(conn, n = 1, warn = FALSE)
  if (length(line) == 0) break
  if (!nzchar(line)) next
  resp <- tryCatch(
    .capture(jsonlite::fromJSON(line, simplifyVector = FALSE)),
    error = function(e) list(
      id = -1, ok = FALSE, result = NULL,
      error = paste("runner:", conditionMessage(e)),
      stdout = "", stderr = "", files = list()
    )
  )
  cat(jsonlite::toJSON(resp, auto_unbox = TRUE, null = "null"), "\n", sep = "")
  flush(stdout())
}
