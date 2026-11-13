inner <- function() stop("boom")
outer <- function() inner()
outer()
