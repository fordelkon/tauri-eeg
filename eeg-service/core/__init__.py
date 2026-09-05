"""Algorithm core of the EEG service.

Everything in this package is pure numpy/scipy/scikit-learn and must never
import pylsl: the native liblsl library is machine-specific, so CI and other
developers' machines cannot be required to have it. LSL transport lives in
``lsl_io`` adapters only.
"""
