"""LSL transport adapters.

This package is the only place allowed to import pylsl, and every import must
be lazy (inside a function) so the service still runs on machines without the
native liblsl library. The algorithm core in ``core`` never touches pylsl.
"""
