import sys
from pathlib import Path

# music-service convention: make the service package importable without
# installing it (tests run from the service directory).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
