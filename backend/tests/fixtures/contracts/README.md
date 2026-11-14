# API contract fixtures

Canonical response shapes for the control-plane API. **pytest** asserts the backend emits the same keys
and types (`tests/test_contracts.py`); the **console** (vitest) and **app** (jest) use these files as mock
responses. Change a shape here first, then make all three surfaces pass.
