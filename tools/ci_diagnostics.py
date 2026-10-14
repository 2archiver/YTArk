"""Expose bounded, redacted compilation diagnostics when raw Actions logs aren't reachable."""
import pathlib
import sys
for name in sys.argv[1:]:
    path = pathlib.Path(name)
    if path.is_file():
        for line in path.read_text(errors='replace').splitlines()[-10:]:
            safe = line.replace('%','%25').replace('\r','').replace('\n','%0A')
            print(f'::error title={path.name}::{safe[:1000]}')
