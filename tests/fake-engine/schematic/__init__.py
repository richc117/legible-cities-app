"""A stand-in for the engine package, for the app's tests.

`PYTHONPATH=tests/fake-engine` puts this `schematic` in front of the real
one, so the app's unchanged command (`<python> -m schematic.serve`) runs
`serve.py` here. Nothing else of the engine exists in it.
"""
