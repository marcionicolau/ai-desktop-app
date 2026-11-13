def inner():
    raise ValueError("boom")
def outer():
    inner()
outer()
