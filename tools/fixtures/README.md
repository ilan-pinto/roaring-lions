# Test fixtures

Synthetic units used to exercise `validate_balance.py` before a real roster
exists. **These are not game content** and must never be loaded by the game.

The numbers are deliberately rough -- several are miscosted on purpose so the
balance gate has something to catch. Run:

    python tools/validate_balance.py --units tools/fixtures/units --report

Delete this directory once `data/units/` holds 15-20 real units.
